import type { z } from 'zod'
import type { updateEventSchema } from '@/lib/validations'
import type { PersonEventActor } from '@/lib/person-event-authority'
import type { EffectResult } from '@/lib/idempotency'
import { EVENT_READ_ONLY_CODE, EVENT_READ_ONLY_MESSAGE } from '@/lib/calendar-import/source'
import { getD1Database, type D1Store, type SqlValue } from './database'
import { d1CalendarEventDto, type D1CalendarEventRow } from './calendar-events'

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
  const dateChanged = input.start_time !== undefined || input.end_time !== undefined
  const repeatGuard = input.expected_recurrence === undefined ? '1' : `e.recurrence IS ${bind(input.expected_recurrence)}`
  const result = await db.batch<ResultRow>([
    db.prepare(`SELECT u.family_id,u.role,u.token_version,f.id AS family_exists FROM "User" u
      LEFT JOIN "Family" f ON f.id=?2 WHERE u.id=?1 AND (?3 IS NOT NULL)`).bind(...principal),
    db.prepare(EVENT).bind(...target),
    db.prepare(`UPDATE "Event" AS e SET ${assignments.join(',')} WHERE e.id=?4 AND e.family_id=?2 AND ${AUTH}
      AND (e.source_subscription_id IS NULL OR e.source_subscription_id='') AND ${repeatGuard}
      AND ${invalidDate ? '0' : dateChanged ? `${endExpression}>=${startExpression}` : '1'}`).bind(...values),
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
  const after = result[3].results[0]
  if (!after) throw new Error('D1 event update response missing')
  const { source: _source, ...event } = d1CalendarEventDto(after)
  void _source
  return { status: 200, body: { event } }
}
