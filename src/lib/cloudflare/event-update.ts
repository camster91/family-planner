import type { z } from 'zod'
import type { updateEventSchema } from '@/lib/validations'
import type { PersonEventActor } from '@/lib/person-event-authority'
import type { EffectResult } from '@/lib/idempotency'
import { EVENT_READ_ONLY_CODE, EVENT_READ_ONLY_MESSAGE } from '@/lib/calendar-import/source'
import { getD1Database, type D1Store, type SqlValue } from './database'
import { d1CalendarEventDto, type D1CalendarEventRow } from './calendar-events'
import { EVENT_PEOPLE_INVALID, EVENT_PEOPLE_UNSUPPORTED, eventPeopleReady } from '@/lib/event-participants'
import { attachD1EventParticipants, d1EventParticipantReplacement } from './event-participants'
import { updateD1EventFollowing } from './event-series-edit'

type Authority = { role: string; family_id: string | null; token_version: number; family_exists: string | null }
const AUTH = `EXISTS (SELECT 1 FROM "User" a JOIN "Family" f ON f.id=a.family_id
  WHERE a.id=?1 AND a.family_id=?2 AND a.token_version=?3 AND a.role='parent')`
const EVENT = `SELECT e.*,c.id AS creator_id,c.name AS creator_name,NULL AS source_name,NULL AS source_color
  FROM "Event" e LEFT JOIN "User" c ON c.id=e.created_by AND c.family_id=e.family_id
  WHERE e.id=?4 AND e.family_id=?2 AND ${AUTH}`
type ResultRow = Authority & D1CalendarEventRow

/** Absolute PATCH decisions and effects share one native primary batch.
 * SQL validates against the current other date bound and repeat rule inside
 * that same batch, so disjoint concurrent fields merge without a stale plan.
 */
export async function updateD1PersonEvent(actor: PersonEventActor, input: z.infer<typeof updateEventSchema>, database?: D1Store): Promise<EffectResult> {
  if (input.series_scope === 'following') return updateD1EventFollowing(actor, input, database)
  const db = (database ?? await getD1Database()).withSession('first-primary')
  const principal: SqlValue[] = [actor.userId, actor.familyId, actor.tokenVersion]
  const target = [...principal, input.eventId]
  const values = [...target]
  const bind = (value: SqlValue) => { values.push(value); return `?${values.length}` }
  const assignments: string[] = []
  for (const column of ['title', 'description', 'location', 'event_type', 'recurrence'] as const)
    if (input[column] !== undefined) assignments.push(`"${column}"=${bind(input[column]!)}`)
  let startExpression = 'e.start_time', endExpression = 'e.end_time'
  let invalidDate = false
  for (const column of ['start_time', 'end_time'] as const) if (input[column] !== undefined) {
    const time = new Date(input[column]).getTime()
    const expression = bind(Number.isFinite(time) ? time : null)
    if (!Number.isFinite(time)) invalidDate = true
    assignments.push(`"${column}"=${expression}`)
    if (column === 'start_time') startExpression = expression
    else endExpression = expression
  }
  assignments.push(`updated_at=${bind(Date.now())}`)
  // Changing one repeat on its own takes it out of later "this and later" rewrites.
  assignments.push(`series_detached=CASE WHEN e.series_id IS NULL THEN e.series_detached ELSE 1 END`)
  const dateChanged = input.start_time !== undefined || input.end_time !== undefined
  const repeatGuard = input.expected_recurrence === undefined ? '1' : `e.recurrence IS ${bind(input.expected_recurrence)}`
  if (input.participants !== undefined && !eventPeopleReady()) return EVENT_PEOPLE_UNSUPPORTED
  // An absolute people list is replaced in the same batch, before the event
  // row changes, under exactly the guard the event UPDATE uses. Every
  // statement therefore sees the same pre-update state and all apply or none.
  const people = input.participants === undefined ? null : d1EventParticipantReplacement(input.participants, bind, '?2', '?4')
  const guard = `EXISTS (SELECT 1 FROM "Event" e WHERE e.id=?4 AND e.family_id=?2 AND ${AUTH}
      AND (e.source_subscription_id IS NULL OR e.source_subscription_id='') AND ${repeatGuard}
      AND ${invalidDate ? '0' : dateChanged ? `${endExpression}>=${startExpression}` : '1'} AND ${people?.valid ?? '1'})`
  // Every statement bound to the shared value list must reference its last
  // placeholder (the same reason the authority read mentions ?3).
  const touch = `(?${values.length} IS NOT NULL)`
  const peopleStatements = people ? [people.remove(`${guard} AND ${touch}`), ...people.inserts(guard)].map((sql) => db.prepare(sql).bind(...values)) : []
  const result = await db.batch<ResultRow & { people_valid?: number }>([
    db.prepare(`SELECT u.family_id,u.role,u.token_version,f.id AS family_exists,${people?.valid ?? '1'} AS people_valid FROM "User" u
      LEFT JOIN "Family" f ON f.id=?2 WHERE u.id=?1 AND (?3 IS NOT NULL)${people ? ` AND ${touch}` : ''}`).bind(...(people ? values : principal)),
    db.prepare(EVENT).bind(...target),
    ...peopleStatements,
    db.prepare(`UPDATE "Event" AS e SET ${assignments.join(',')} WHERE e.id=?4 AND e.family_id=?2 AND ${AUTH}
      AND (e.source_subscription_id IS NULL OR e.source_subscription_id='') AND ${repeatGuard}
      AND ${invalidDate ? '0' : dateChanged ? `${endExpression}>=${startExpression}` : '1'} AND ${people?.valid ?? '1'} AND ${touch}`).bind(...values),
    db.prepare(EVENT).bind(...target),
  ])
  const authority = result[0].results[0]
  if (!authority || authority.token_version !== actor.tokenVersion) return { status: 401, body: { error: 'Unauthorized' } }
  if (authority.family_id !== actor.familyId || authority.role !== 'parent')
    return { status: 403, body: { error: 'This account cannot perform this calendar action in this household' } }
  if (!authority.family_exists) return { status: 404, body: { error: 'Household not found' } }
  const before = result[1].results[0]
  if (!before) return { status: 404, body: { error: 'Event not found' } }
  if (before.source_subscription_id) return { status: 409, body: { error: EVENT_READ_ONLY_MESSAGE, code: EVENT_READ_ONLY_CODE } }
  if (input.expected_recurrence !== undefined && before.recurrence !== input.expected_recurrence)
    return { status: 409, body: { error: 'The saved repeat rule changed. Reopen the event before removing it.', code: 'EVENT_RECURRENCE_CHANGED' } }
  if (invalidDate) return { status: 400, body: { error: 'Invalid start or end time' } }
  const start = input.start_time === undefined ? before.start_time : new Date(input.start_time).getTime()
  const end = input.end_time === undefined ? before.end_time : new Date(input.end_time).getTime()
  if (dateChanged && end < start) return { status: 400, body: { error: 'End time must be after start time' } }
  if (people && authority.people_valid !== 1) return EVENT_PEOPLE_INVALID
  const after = result[result.length - 1].results[0]
  if (!after) throw new Error('D1 event update response missing')
  const { source: _source, ...event } = d1CalendarEventDto(after)
  void _source
  const [withPeople] = await attachD1EventParticipants(db, actor.familyId, [event])
  return { status: 200, body: { event: withPeople } }
}
