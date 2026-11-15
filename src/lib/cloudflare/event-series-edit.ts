import { randomUUID } from 'node:crypto'
import type { z } from 'zod'
import type { updateEventSchema } from '@/lib/validations'
import type { PersonEventActor } from '@/lib/person-event-authority'
import type { EffectResult } from '@/lib/idempotency'
import { EVENT_READ_ONLY_CODE, EVENT_READ_ONLY_MESSAGE } from '@/lib/calendar-import/source'
import {
  EVENT_PEOPLE_INVALID, EVENT_PEOPLE_UNSUPPORTED, eventPeopleReady, unknownEventPeople, type EventPersonRef,
} from '@/lib/event-participants'
import {
  EVENT_NOT_REPEATING, EVENT_REPEAT_UNSUPPORTED, dayBefore, eventRepeatReady, isFollowingRefusal, localDayIn,
  planFollowingEdit, seriesTopUpTarget, type EventRepeatEvery,
} from '@/lib/event-series'
import { getD1Database, type D1Statement, type D1Store, type SqlValue } from './database'
import { d1WriteCheck, isD1WriteConflict } from './write-check'
import { d1CalendarEventDto, type D1CalendarEventRow } from './calendar-events'
import { attachD1EventParticipants, d1EventParticipantInserts, readD1HouseholdPeople } from './event-participants'
import { SERIES_COMPLETE, d1SeriesOccurrenceStatements, planSeriesRows, type D1EventSeriesRow } from './event-series'

type Session = Pick<D1Store, 'prepare' | 'batch'>
type Authority = { role: string; family_id: string | null; token_version: number; family_exists: string | null }
const AUTH = `EXISTS (SELECT 1 FROM "User" a JOIN "Family" f ON f.id=a.family_id
  WHERE a.id=?1 AND a.family_id=?2 AND a.token_version=?3 AND a.role='parent')`
const EVENT = `SELECT e.*,c.id AS creator_id,c.name AS creator_name,NULL AS source_name,NULL AS source_color
  FROM "Event" e LEFT JOIN "User" c ON c.id=e.created_by AND c.family_id=e.family_id WHERE e.id=?2 AND e.family_id=?1`
type EventRow = D1CalendarEventRow & { series_id: string | null; series_occurrence_start: number | null }

/** `startRepeating`: a one-off event of this app may be the target, to begin a repeat from it. */
async function target(db: Session, actor: PersonEventActor, eventId: string, startRepeating = false): Promise<{ refused: EffectResult } | { event: EventRow; series: D1EventSeriesRow | null }> {
  const authority = await db.prepare(`SELECT u.family_id,u.role,u.token_version,f.id AS family_exists FROM "User" u
    LEFT JOIN "Family" f ON f.id=?2 WHERE u.id=?1`).bind(actor.userId, actor.familyId).first<Authority>()
  if (!authority || authority.token_version !== actor.tokenVersion) return { refused: { status: 401, body: { error: 'Unauthorized' } } }
  if (authority.family_id !== actor.familyId || authority.role !== 'parent')
    return { refused: { status: 403, body: { error: 'This account cannot perform this calendar action in this household' } } }
  if (!authority.family_exists) return { refused: { status: 404, body: { error: 'Household not found' } } }
  const event = await db.prepare(EVENT).bind(actor.familyId, eventId).first<EventRow>()
  if (!event) return { refused: { status: 404, body: { error: 'Event not found' } } }
  if (event.source_subscription_id) return { refused: { status: 409, body: { error: EVENT_READ_ONLY_MESSAGE, code: EVENT_READ_ONLY_CODE } } }
  if (!eventRepeatReady()) return { refused: EVENT_REPEAT_UNSUPPORTED }
  const series = event.series_id === null || event.series_occurrence_start === null ? null
    : await db.prepare(`SELECT id,family_id,created_by,every,time_zone,anchor_start,duration_ms,until_day,title,description,location,event_type,
        participants,generated_through,updated_at FROM "EventSeries" WHERE id=?1 AND family_id=?2`).bind(event.series_id, actor.familyId).first<D1EventSeriesRow>()
  if (!series) {
    // Events that carry a stored rule or come from a connected calendar keep their own repeat handling.
    return startRepeating && event.series_id === null && event.recurrence === null && event.source_connection_id === null
      ? { event, series: null } : { refused: EVENT_NOT_REPEATING }
  }
  return { event, series }
}

/** The batch may only apply to exactly the rows this plan was made from. */
function guards(db: Session, actor: PersonEventActor, event: EventRow, series: D1EventSeriesRow | null): D1Statement[] {
  return [
    d1WriteCheck(db, AUTH, [actor.userId, actor.familyId, actor.tokenVersion]),
    d1WriteCheck(db, `EXISTS (SELECT 1 FROM "Event" WHERE id=?1 AND family_id=?2 AND updated_at=?3 AND series_id IS ?4
      AND (source_subscription_id IS NULL OR source_subscription_id=''))`, [event.id, actor.familyId, event.updated_at, series?.id ?? null]),
    ...(series ? [d1WriteCheck(db, `EXISTS (SELECT 1 FROM "EventSeries" WHERE id=?1 AND family_id=?2 AND updated_at=?3)`, [series.id, actor.familyId, series.updated_at])] : []),
  ]
}
/** End the series the edited or deleted occurrence came from, the day before it. */
function endPrevious(db: Session, series: D1EventSeriesRow, first: boolean, occurrenceStart: number, now: number): D1Statement {
  return first
    ? db.prepare(`DELETE FROM "EventSeries" WHERE id=?1 AND family_id=?2`).bind(series.id, series.family_id)
    : db.prepare(`UPDATE "EventSeries" SET until_day=?3,generated_through=?4,updated_at=?5 WHERE id=?1 AND family_id=?2`)
      .bind(series.id, series.family_id, dayBefore(localDayIn(occurrenceStart, series.time_zone)), SERIES_COMPLETE, now)
}

/** PATCH with series_scope 'following': this event and every later repeat. */
export async function updateD1EventFollowing(actor: PersonEventActor, input: z.infer<typeof updateEventSchema>, database?: D1Store): Promise<EffectResult> {
  const db = (database ?? await getD1Database()).withSession('first-primary')
  for (let attempt = 0; attempt < 6; attempt++) {
    const found = await target(db, actor, input.eventId, input.repeat != null)
    if ('refused' in found) return found.refused
    const { event, series } = found
    const occurrenceStart = event.series_occurrence_start ?? event.start_time
    const owner = series?.created_by ?? event.created_by
    let refs: EventPersonRef[]
    const household = eventPeopleReady() || input.participants !== undefined ? await readD1HouseholdPeople(db, actor.familyId) : new Map()
    if (input.participants !== undefined) {
      if (!eventPeopleReady()) return EVENT_PEOPLE_UNSUPPORTED
      if (unknownEventPeople(input.participants, household).length) return EVENT_PEOPLE_INVALID
      refs = input.participants
    } else {
      const rows = await db.prepare(`SELECT user_id,member_id FROM "EventParticipant" WHERE event_id=?1 AND family_id=?2 ORDER BY created_at,id`)
        .bind(event.id, actor.familyId).all<{ user_id: string | null; member_id: string | null }>()
      refs = rows.results.map((row) => row.user_id !== null ? { kind: 'account' as const, id: row.user_id } : { kind: 'profile' as const, id: row.member_id! })
    }
    const plan = planFollowingEdit({
      event: { start: event.start_time, end: event.end_time, title: event.title, description: event.description, location: event.location,
        event_type: event.event_type, occurrenceStart },
      series: series ? { every: series.every as EventRepeatEvery, timeZone: series.time_zone, untilDay: series.until_day, anchorStart: series.anchor_start } : null,
    }, input)
    if (isFollowingRefusal(plan)) return plan
    const now = Date.now()
    const next = plan.rule ? { id: randomUUID(), ...planSeriesRows(plan.rule, -1, Math.max(seriesTopUpTarget(now), plan.start)) } : null
    const { title, description, location, event_type } = plan.template
    const values: SqlValue[] = [event.id, actor.familyId, title, description, location, event_type, plan.start, plan.end, now, next?.id ?? null]
    const statements: D1Statement[] = [
      ...guards(db, actor, event, series),
      // Every later repeat is rewritten below, including ones changed on their own: keeping those would leave two events on one day.
      ...(series ? [
        db.prepare(`DELETE FROM "Event" WHERE family_id=?1 AND series_id=?2 AND series_occurrence_start>?3`).bind(actor.familyId, series.id, occurrenceStart),
        endPrevious(db, series, plan.previous.kind === 'remove', occurrenceStart, now),
      ] : []),
    ]
    if (next && plan.rule) statements.push(db.prepare(`INSERT INTO "EventSeries" (id,family_id,created_by,every,time_zone,anchor_start,duration_ms,until_day,title,description,location,event_type,participants,generated_through,created_at,updated_at)
        VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?15)`)
      .bind(next.id, actor.familyId, owner, plan.rule.every, plan.rule.timeZone, plan.start, plan.end - plan.start, plan.rule.untilDay,
        title, description, location, event_type, JSON.stringify(refs), next.generatedThrough, now))
    statements.push(db.prepare(`UPDATE "Event" SET title=?3,description=?4,location=?5,event_type=?6,start_time=?7,end_time=?8,updated_at=?9,
        series_id=?10,series_occurrence_start=CASE WHEN ?10 IS NULL THEN NULL ELSE ?7 END,series_detached=0 WHERE id=?1 AND family_id=?2`).bind(...values))
    if (input.participants !== undefined) {
      statements.push(db.prepare(`DELETE FROM "EventParticipant" WHERE event_id=?1 AND family_id=?2`).bind(event.id, actor.familyId))
      statements.push(...d1EventParticipantInserts(db, event.id, actor.familyId, refs, now))
    }
    if (next) statements.push(...d1SeriesOccurrenceStatements(db, { id: next.id, family_id: actor.familyId, created_by: owner,
      duration_ms: plan.end - plan.start, title, description, location, event_type }, next.starts.filter((start) => start !== plan.start), refs, now))
    try { await db.batch(statements) } catch (cause) { if (isD1WriteConflict(cause)) continue; throw cause }
    const after = await db.prepare(EVENT).bind(actor.familyId, event.id).first<EventRow>()
    if (!after) throw new Error('D1 event series update response missing')
    const { source: _source, ...dto } = d1CalendarEventDto(after)
    void _source
    const [withPeople] = await attachD1EventParticipants(db, actor.familyId, [dto])
    return { status: 200, body: { event: withPeople } }
  }
  return { status: 409, body: { error: 'This event changed. Reopen it and try again.', code: 'EVENT_CHANGED' } }
}

/** DELETE with series_scope 'following': this event and every later repeat. */
export async function deleteD1EventFollowing(actor: PersonEventActor, eventId: string, database?: D1Store): Promise<EffectResult> {
  const db = (database ?? await getD1Database()).withSession('first-primary')
  for (let attempt = 0; attempt < 6; attempt++) {
    const found = await target(db, actor, eventId)
    if ('refused' in found) return found.refused
    const { event, series } = found
    if (!series) return EVENT_NOT_REPEATING
    const occurrenceStart = event.series_occurrence_start!
    try {
      await db.batch([
        ...guards(db, actor, event, series),
        db.prepare(`DELETE FROM "Event" WHERE family_id=?1 AND series_id=?2 AND series_occurrence_start>=?3`).bind(actor.familyId, series.id, occurrenceStart),
        endPrevious(db, series, occurrenceStart === series.anchor_start, occurrenceStart, Date.now()),
      ])
      return { status: 200, body: { success: true } }
    } catch (cause) { if (isD1WriteConflict(cause)) continue; throw cause }
  }
  return { status: 409, body: { error: 'This event changed. Reopen it and try again.', code: 'EVENT_CHANGED' } }
}
