import {
  eventRepeatReady, seriesEventId, seriesOccurrences, seriesTopUpTarget, SERIES_TOP_UP_MAX,
  type EventRepeatEvery, type SeriesRule,
} from '@/lib/event-series'
import { eventPeopleReady, eventPersonKey, type EventPerson, type EventPersonRef } from '@/lib/event-participants'
import type { D1Statement, D1Store, SqlValue } from './database'
import { readD1HouseholdPeople } from './event-participants'

type Session = Pick<D1Store, 'prepare' | 'batch'>
/** No occurrence is left to write: never selected for top-up again. */
export const SERIES_COMPLETE = 253_402_300_799_000

export type D1EventSeriesRow = {
  id: string; family_id: string; created_by: string; every: string; time_zone: string; anchor_start: number
  duration_ms: number; until_day: string | null; title: string; description: string | null; location: string | null
  event_type: string; participants: string; generated_through: number; updated_at: number
}
export type SeriesTemplate = Pick<D1EventSeriesRow, 'id' | 'family_id' | 'created_by' | 'duration_ms' | 'title' | 'description' | 'location' | 'event_type'>

export const d1SeriesRule = (row: Pick<D1EventSeriesRow, 'every' | 'time_zone' | 'anchor_start' | 'until_day'>): SeriesRule =>
  ({ every: row.every as EventRepeatEvery, timeZone: row.time_zone, anchorStart: row.anchor_start, untilDay: row.until_day })

/** Stored template people as refs; anything malformed is no people. */
export function parseSeriesPeople(raw: string): EventPersonRef[] {
  try {
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) return []
    return value.flatMap((item) => item && typeof item === 'object' && (item.kind === 'account' || item.kind === 'profile') && typeof item.id === 'string'
      ? [{ kind: item.kind, id: item.id } as EventPersonRef] : []).slice(0, 12)
  } catch { return [] }
}

/** What a top-up or create writes for a rule: the starts and the new high-water mark. */
export function planSeriesRows(rule: SeriesRule, afterMs: number, targetMs: number) {
  const { starts, done } = seriesOccurrences(rule, afterMs, targetMs)
  const generatedThrough = done ? SERIES_COMPLETE : starts.length >= SERIES_TOP_UP_MAX ? starts[starts.length - 1] : targetMs
  return { starts, generatedThrough }
}

/**
 * Statements that write occurrence rows (and their people) for one series.
 * Ids are derived from the series and the start, and every insert is OR
 * IGNORE, so two readers topping up at once write each occurrence once.
 * People are current household members only, re-proved in SQL.
 */
export function d1SeriesOccurrenceStatements(
  db: Session, series: SeriesTemplate, starts: ReadonlyArray<number>, people: ReadonlyArray<EventPersonRef>, now: number,
): D1Statement[] {
  const statements: D1Statement[] = []
  for (let offset = 0; offset < starts.length; offset += 7) {
    const chunk = starts.slice(offset, offset + 7)
    const values: SqlValue[] = [series.family_id, series.created_by, series.title, series.description, series.location, series.event_type, now, series.id]
    const rows = chunk.map((start) => {
      values.push(seriesEventId(series.id, start), start, start + series.duration_ms)
      const n = values.length
      return `(?${n - 2},?1,?2,?3,?4,?5,?${n - 1},?${n},?6,?7,?7,?8,?${n - 1})`
    })
    statements.push(db.prepare(`INSERT OR IGNORE INTO "Event"
      (id,family_id,created_by,title,description,location,start_time,end_time,event_type,created_at,updated_at,series_id,series_occurrence_start)
      VALUES ${rows.join(',')}`).bind(...values))
  }
  for (const ref of people) {
    const account = ref.kind === 'account'
    // One statement per person covers every new occurrence of this series.
    for (let offset = 0; offset < starts.length; offset += 40) {
      const chunk = starts.slice(offset, offset + 40)
      const values: SqlValue[] = [series.family_id, ref.id, now, series.id]
      const ids = chunk.map((start) => { values.push(seriesEventId(series.id, start)); return `?${values.length}` })
      statements.push(db.prepare(`INSERT OR IGNORE INTO "EventParticipant" (id,event_id,family_id,user_id,member_id,created_at)
        SELECT e.id || ':${account ? 'a' : 'p'}:' || ?2, e.id, ?1, ${account ? '?2,NULL' : 'NULL,?2'}, ?3 FROM "Event" e
        WHERE e.family_id=?1 AND e.series_id=?4 AND e.id IN (${ids.join(',')}) AND ${account
          ? `EXISTS (SELECT 1 FROM "User" u WHERE u.id=?2 AND u.family_id=?1)`
          : `EXISTS (SELECT 1 FROM "HouseholdMember" m WHERE m.id=?2 AND m.family_id=?1 AND m.archived_at IS NULL AND m.erasure_user_id IS NULL)`}`)
        .bind(...values))
    }
  }
  return statements
}

/** Template people that are current household members, in the stored order. */
export function currentSeriesPeople(raw: string, people: ReadonlyMap<string, EventPerson>): EventPersonRef[] {
  return eventPeopleReady() ? parseSeriesPeople(raw).filter((ref) => people.has(eventPersonKey(ref))) : []
}

/**
 * Write the occurrences a reader is about to look at. Called from read paths
 * (calendar range, Today board): there is no scheduler. A failure here must
 * never fail the read, so callers go through topUpHouseholdEventSeries.
 */
export async function topUpD1EventSeries(db: Session, familyId: string, now: Date, wantedMs?: number): Promise<number> {
  if (!eventRepeatReady()) return 0
  const target = seriesTopUpTarget(now.getTime(), wantedMs)
  const due = await db.prepare(`SELECT id,family_id,created_by,every,time_zone,anchor_start,duration_ms,until_day,title,description,location,
      event_type,participants,generated_through,updated_at FROM "EventSeries"
    WHERE family_id=?1 AND generated_through<?2 ORDER BY generated_through ASC,id ASC LIMIT 20`)
    .bind(familyId, target).all<D1EventSeriesRow>()
  if (!due.results.length) return 0
  const people = await readD1HouseholdPeople(db, familyId)
  let written = 0
  for (const series of due.results) {
    const plan = planSeriesRows(d1SeriesRule(series), series.generated_through, target)
    await db.batch([
      ...d1SeriesOccurrenceStatements(db, series, plan.starts, currentSeriesPeople(series.participants, people), now.getTime()),
      // Only ever moves forward; a concurrent reader's further mark is kept.
      db.prepare(`UPDATE "EventSeries" SET generated_through=max(generated_through,?3) WHERE id=?1 AND family_id=?2`)
        .bind(series.id, familyId, plan.generatedThrough),
    ])
    written += plan.starts.length
  }
  return written
}
