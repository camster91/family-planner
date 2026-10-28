import type { Event } from '@prisma/client'
import type { CalendarReadOwner } from '@/lib/calendar-read-owner'
import type { CalendarRange } from '@/lib/calendar-planning/range'
import { normalizeFeatures, isFeatureEnabled } from '@/lib/feature-flags'
import { MEMBER_ID_PATTERN } from '@/lib/member-identity-schema'
import { getD1Database, type D1Store, type SqlValue } from './database'

type Row = Omit<Event, 'start_time' | 'end_time' | 'created_at' | 'updated_at' | 'source_occurrence_start' | 'is_task'> & {
  start_time: number; end_time: number; created_at: number; updated_at: number;
  source_occurrence_start: number | null; is_task: number;
  creator_id: string | null; creator_name: string | null; source_name: string | null; source_color: string | null;
}
const AUTH = `EXISTS (SELECT 1 FROM "User" a JOIN "Family" f ON f.id=a.family_id
  WHERE a.id=?1 AND a.family_id=?2 AND a.role=?3 AND a.token_version=?4)`
const args = (owner: CalendarReadOwner): SqlValue[] => [owner.actorId, owner.familyId, owner.role, owner.generation]
function eventDto(row: Row) {
  const { creator_id, creator_name, source_name, source_color, ...event } = row
  return { ...event, start_time: new Date(row.start_time), end_time: new Date(row.end_time),
    created_at: new Date(row.created_at), updated_at: new Date(row.updated_at),
    source_occurrence_start: row.source_occurrence_start === null ? null : new Date(row.source_occurrence_start),
    is_task: row.is_task === 1,
    creator: creator_id === null ? null : { id: creator_id, name: creator_name! },
    source: row.source_subscription_id ? { subscription_id: row.source_subscription_id, name: source_name ?? 'Subscribed calendar', color: source_color } : null }
}
/** Read the canonical scalar event shape with only current same-family names.
 * No feed URL, subscription ciphertext or account metadata enters the result. */
export async function readD1CalendarEvents(owner: CalendarReadOwner, query: { id?: string; range?: CalendarRange; upcoming?: boolean; now?: Date } = {}, database?: D1Store) {
  const db = (database ?? await getD1Database()).withSession('first-primary')
  const values = args(owner)
  const bind = (value: SqlValue) => { values.push(value); return `?${values.length}` }
  let filter = ''
  let limit = 100
  if (query.id !== undefined) { filter = `AND e.id=${bind(query.id)}`; limit = 1 }
  else if (query.range) {
    const { start, end, after } = query.range
    const lower = bind(start.getTime()), upper = bind(end.getTime())
    filter = `AND ((e.start_time>=${lower} AND e.start_time<${upper}) OR (e.start_time<${lower} AND e.end_time>${lower}))`
    if (after) { const time = bind(after.start.getTime()); filter += ` AND (e.start_time>${time} OR (e.start_time=${time} AND e.id>${bind(after.id)}))` }
    limit = query.range.limit + 1
  } else if (query.upcoming) filter = `AND e.start_time>=${bind((query.now ?? new Date()).getTime())}`
  else filter = `AND (e.end_time>=${bind((query.now ?? new Date()).getTime() - 30 * 86400000)} OR e.recurrence IS NOT NULL)`
  const rows = await db.prepare(`SELECT e.*,c.id AS creator_id,c.name AS creator_name,s.name AS source_name,s.color AS source_color
    FROM "Event" e LEFT JOIN "User" c ON c.id=e.created_by AND c.family_id=e.family_id
    LEFT JOIN "CalendarSubscription" s ON s.id=e.source_subscription_id AND s.family_id=e.family_id
    WHERE e.family_id=?2 AND ${AUTH} ${filter} ORDER BY e.start_time,e.id LIMIT ${bind(limit)}`)
    .bind(...values).all<Row>()
  return rows.results.map(eventDto)
}
export async function readD1CalendarViewer(userId: string, generation: number, database?: D1Store) {
  return (database ?? await getD1Database()).withSession('first-primary')
    .prepare(`SELECT family_id,role,token_version FROM "User" WHERE id=?1 AND token_version=?2`)
    .bind(userId, generation).first<{ family_id: string | null; role: string; token_version: number }>()
}
export async function readD1EventNotificationFocus(owner: CalendarReadOwner, target: unknown, database?: D1Store) {
  if (typeof target !== 'string' || !MEMBER_ID_PATTERN.test(target) || !['parent', 'teen'].includes(owner.role)
    || !Number.isSafeInteger(owner.generation) || owner.generation < 0) return null
  const row = await (database ?? await getD1Database()).withSession('first-primary').prepare(`SELECT e.id,e.title,e.start_time,e.end_time,f.features
    FROM "Event" e JOIN "Family" f ON f.id=e.family_id WHERE e.family_id=?2 AND e.id=?5 AND e.recurrence IS NULL AND ${AUTH}`)
    .bind(...args(owner), target).first<{ id: string; title: string; start_time: number; end_time: number; features: string | null }>()
  if (!row || !isFeatureEnabled(normalizeFeatures(row.features === null ? null : JSON.parse(row.features)), 'calendar')) return null
  const start = new Date(row.start_time), end = new Date(row.end_time)
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return null
  return { id: row.id, title: row.title, start: start.toISOString(), end: end.toISOString() }
}
