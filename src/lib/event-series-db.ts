/**
 * Repeating events: PostgreSQL/Prisma side of src/lib/event-series.ts. The D1
 * side is src/lib/cloudflare/event-series*.ts; both apply the same plan.
 */
import type { Prisma, PrismaClient } from '@prisma/client'
import type { z } from 'zod'
import type { updateEventSchema } from './validations'
import type { EffectResult } from './idempotency'
import { authorizePersonEventInTx, type PersonEventActor } from './person-event-authority'
import { EVENT_READ_ONLY_CODE, EVENT_READ_ONLY_MESSAGE } from './calendar-import/source'
import {
  EVENT_PEOPLE_INVALID, EVENT_PEOPLE_UNSUPPORTED, eventPeopleReady, eventPersonKey, unknownEventPeople,
  type EventPerson, type EventPersonRef,
} from './event-participants'
import { projectEventParticipants, readHouseholdPeople, replaceEventParticipantsInTx } from './event-participants-db'
import {
  EVENT_NOT_REPEATING, EVENT_REPEAT_UNSUPPORTED, SERIES_TOP_UP_MAX, eventRepeatReady, isFollowingRefusal, planFollowingEdit,
  seriesEventId, seriesOccurrences, seriesTopUpTarget, type EventRepeatEvery, type SeriesRule,
} from './event-series'

type Tx = Prisma.TransactionClient
/** No occurrence is left to write: never selected for top-up again. */
export const SERIES_COMPLETE = new Date(253_402_300_799_000)
type Template = { id: string; family_id: string; created_by: string; duration_ms: number; title: string; description: string | null; location: string | null; event_type: string }

function parsePeople(raw: string): EventPersonRef[] {
  try {
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) return []
    return value.flatMap((item) => item && typeof item === 'object' && (item.kind === 'account' || item.kind === 'profile') && typeof item.id === 'string'
      ? [{ kind: item.kind, id: item.id } as EventPersonRef] : []).slice(0, 12)
  } catch { return [] }
}
export function planSeriesRows(rule: SeriesRule, afterMs: number, targetMs: number) {
  const { starts, done } = seriesOccurrences(rule, afterMs, targetMs)
  return { starts, generatedThrough: done ? SERIES_COMPLETE : new Date(starts.length >= SERIES_TOP_UP_MAX ? starts[starts.length - 1] : targetMs) }
}

/** Write occurrence rows and their people; derived ids make it idempotent. */
export async function writeSeriesOccurrencesInTx(tx: Pick<Tx, 'event' | 'eventParticipant'>, series: Template, starts: ReadonlyArray<number>, people: ReadonlyArray<EventPersonRef>) {
  if (!starts.length) return
  await tx.event.createMany({
    skipDuplicates: true,
    data: starts.map((start) => ({
      id: seriesEventId(series.id, start), family_id: series.family_id, created_by: series.created_by, title: series.title,
      description: series.description, location: series.location, event_type: series.event_type,
      start_time: new Date(start), end_time: new Date(start + series.duration_ms), series_id: series.id, series_occurrence_start: new Date(start),
    })),
  })
  if (people.length) await tx.eventParticipant.createMany({
    skipDuplicates: true,
    data: starts.flatMap((start) => people.map((ref) => ({
      id: `${seriesEventId(series.id, start)}:${ref.kind === 'account' ? 'a' : 'p'}:${ref.id}`,
      event_id: seriesEventId(series.id, start), family_id: series.family_id,
      user_id: ref.kind === 'account' ? ref.id : null, member_id: ref.kind === 'profile' ? ref.id : null,
    }))),
  })
}
const current = (raw: string, people: ReadonlyMap<string, EventPerson>) =>
  eventPeopleReady() ? parsePeople(raw).filter((ref) => people.has(eventPersonKey(ref))) : []

/** Write the occurrences a reader is about to look at (no scheduler). */
export async function topUpEventSeries(db: Pick<PrismaClient, '$transaction'>, familyId: string, now: Date, wantedMs?: number): Promise<number> {
  if (!eventRepeatReady()) return 0
  const target = seriesTopUpTarget(now.getTime(), wantedMs)
  return db.$transaction(async (tx) => {
    // Serialize concurrent readers per series; rows are idempotent anyway.
    const due = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "EventSeries"
      WHERE "family_id" = ${familyId} AND "generated_through" < ${new Date(target)} ORDER BY "generated_through", "id" LIMIT 20 FOR UPDATE SKIP LOCKED`
    if (!due.length) return 0
    const people = await readHouseholdPeople(tx, familyId)
    let written = 0
    for (const { id } of due) {
      const series = await tx.eventSeries.findFirst({ where: { id, family_id: familyId } })
      if (!series || series.generated_through.getTime() >= target) continue
      const plan = planSeriesRows({ every: series.every as EventRepeatEvery, timeZone: series.time_zone, anchorStart: series.anchor_start.getTime(), untilDay: series.until_day },
        series.generated_through.getTime(), target)
      await writeSeriesOccurrencesInTx(tx, series, plan.starts, current(series.participants, people))
      await tx.eventSeries.update({ where: { id }, data: { generated_through: plan.generatedThrough } })
      written += plan.starts.length
    }
    return written
  })
}

type Found = { refused: EffectResult } | { event: NonNullable<Awaited<ReturnType<Tx['event']['findFirst']>>>; series: NonNullable<Awaited<ReturnType<Tx['eventSeries']['findFirst']>>> }
async function targetInTx(tx: Tx, actor: PersonEventActor, eventId: string): Promise<Found> {
  const refused = await authorizePersonEventInTx(tx, actor, 'edit')
  if (refused) return { refused }
  await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id"=${eventId} AND "family_id"=${actor.familyId} FOR UPDATE`
  const event = await tx.event.findFirst({ where: { id: eventId, family_id: actor.familyId } })
  if (!event) return { refused: { status: 404, body: { error: 'Event not found' } } }
  if (event.source_subscription_id) return { refused: { status: 409, body: { error: EVENT_READ_ONLY_MESSAGE, code: EVENT_READ_ONLY_CODE } } }
  if (!eventRepeatReady()) return { refused: EVENT_REPEAT_UNSUPPORTED }
  if (!event.series_id || !event.series_occurrence_start) return { refused: EVENT_NOT_REPEATING }
  await tx.$queryRaw`SELECT "id" FROM "EventSeries" WHERE "id"=${event.series_id} AND "family_id"=${actor.familyId} FOR UPDATE`
  const series = await tx.eventSeries.findFirst({ where: { id: event.series_id, family_id: actor.familyId } })
  return series ? { event, series } : { refused: EVENT_NOT_REPEATING }
}
/** End the series the edited or deleted occurrence came from, the day before it. */
async function endPreviousInTx(tx: Tx, seriesId: string, previous: { kind: 'remove' } | { kind: 'end'; untilDay: string }) {
  if (previous.kind === 'remove') await tx.eventSeries.delete({ where: { id: seriesId } })
  else await tx.eventSeries.update({ where: { id: seriesId }, data: { until_day: previous.untilDay, generated_through: SERIES_COMPLETE } })
}

/** PATCH with series_scope 'following': this event and every later repeat. */
export async function updatePersonEventFollowing(db: Pick<PrismaClient, '$transaction'>, actor: PersonEventActor, input: z.infer<typeof updateEventSchema>): Promise<EffectResult> {
  return db.$transaction(async (tx) => {
    const found = await targetInTx(tx, actor, input.eventId)
    if ('refused' in found) return found.refused
    const { event, series } = found
    const occurrenceStart = event.series_occurrence_start!
    let refs: EventPersonRef[]
    if (input.participants !== undefined) {
      if (!eventPeopleReady()) return EVENT_PEOPLE_UNSUPPORTED
      if (unknownEventPeople(input.participants, await readHouseholdPeople(tx, actor.familyId)).length) return EVENT_PEOPLE_INVALID
      refs = input.participants
    } else {
      refs = (await tx.eventParticipant.findMany({ where: { event_id: event.id, family_id: actor.familyId }, orderBy: [{ created_at: 'asc' }, { id: 'asc' }] }))
        .map((row) => row.user_id !== null ? { kind: 'account' as const, id: row.user_id } : { kind: 'profile' as const, id: row.member_id! })
    }
    const plan = planFollowingEdit({
      event: { start: event.start_time.getTime(), end: event.end_time.getTime(), title: event.title, description: event.description, location: event.location,
        event_type: event.event_type, occurrenceStart: occurrenceStart.getTime() },
      series: { every: series.every as EventRepeatEvery, timeZone: series.time_zone, untilDay: series.until_day, anchorStart: series.anchor_start.getTime() },
    }, input)
    if (isFollowingRefusal(plan)) return plan
    // Every later repeat is rewritten below, including ones changed on their own: keeping those would leave two events on one day.
    await tx.event.deleteMany({ where: { family_id: actor.familyId, series_id: series.id, series_occurrence_start: { gt: occurrenceStart } } })
    // Detach the edited event before the old series can be removed.
    const next = plan.rule ? await tx.eventSeries.create({ data: {
      family_id: actor.familyId, created_by: series.created_by, every: plan.rule.every, time_zone: plan.rule.timeZone, anchor_start: new Date(plan.start),
      duration_ms: plan.end - plan.start, until_day: plan.rule.untilDay, ...plan.template, participants: JSON.stringify(refs), generated_through: new Date(plan.start),
    } }) : null
    const updated = await tx.event.update({ where: { id: event.id, family_id: actor.familyId }, data: {
      ...plan.template, start_time: new Date(plan.start), end_time: new Date(plan.end),
      series_id: next?.id ?? null, series_occurrence_start: next ? new Date(plan.start) : null, series_detached: false,
    }, include: { creator: { select: { id: true, name: true } } } })
    await endPreviousInTx(tx, series.id, plan.previous)
    if (input.participants !== undefined) await replaceEventParticipantsInTx(tx, event.id, actor.familyId, refs)
    if (next && plan.rule) {
      const rows = planSeriesRows(plan.rule, plan.start, Math.max(seriesTopUpTarget(Date.now()), plan.start))
      await writeSeriesOccurrencesInTx(tx, { id: next.id, family_id: actor.familyId, created_by: series.created_by, duration_ms: plan.end - plan.start, ...plan.template }, rows.starts, refs)
      await tx.eventSeries.update({ where: { id: next.id }, data: { generated_through: rows.generatedThrough } })
    }
    const [withPeople] = await projectEventParticipants(tx, actor.familyId, [updated])
    return { status: 200, body: { event: withPeople } }
  })
}

/** DELETE with series_scope 'following': this event and every later repeat. */
export async function deletePersonEventFollowing(db: Pick<PrismaClient, '$transaction'>, actor: PersonEventActor, eventId: string): Promise<EffectResult> {
  return db.$transaction(async (tx) => {
    const found = await targetInTx(tx, actor, eventId)
    if ('refused' in found) return found.refused
    const { event, series } = found
    const occurrenceStart = event.series_occurrence_start!
    const plan = planFollowingEdit({
      event: { start: event.start_time.getTime(), end: event.end_time.getTime(), title: event.title, description: event.description, location: event.location,
        event_type: event.event_type, occurrenceStart: occurrenceStart.getTime() },
      series: { every: series.every as EventRepeatEvery, timeZone: series.time_zone, untilDay: series.until_day, anchorStart: series.anchor_start.getTime() },
    }, { repeat: null })
    if (isFollowingRefusal(plan)) return plan
    await tx.event.deleteMany({ where: { family_id: actor.familyId, series_id: series.id, series_occurrence_start: { gte: occurrenceStart } } })
    await endPreviousInTx(tx, series.id, plan.previous)
    return { status: 200, body: { success: true } }
  })
}

/** How one event repeats, for the edit form. Null for a one-off event. */
export async function readEventRepeat(db: Pick<PrismaClient, 'eventSeries'>, familyId: string, seriesId: string | null | undefined) {
  if (!seriesId || !eventRepeatReady()) return null
  const row = await db.eventSeries.findFirst({ where: { id: seriesId, family_id: familyId }, select: { every: true, until_day: true, time_zone: true } })
  return row ? { every: row.every, until: row.until_day, time_zone: row.time_zone } : null
}
