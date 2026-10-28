import { randomUUID } from 'node:crypto'
import type { CalendarSubscriptionActor } from '@/lib/calendar-subscription-access'
import { MAX_SUBSCRIPTIONS_PER_FAMILY } from '@/lib/calendar-subscription-list'
import { toSubscriptionDto } from '@/lib/calendar-import/subscription-dto'
import { getD1Database, type D1Store, type SqlValue } from './database'

type Mode = 'read' | 'create' | 'manage' | 'refresh'
type Outcome<T> = { kind: 'held' } | { kind: 'data'; value: T }
type SubscriptionRow = {
  id: string; name: string; color: string | null; url_enc: string;
  last_fetched_at: number | null; last_status: string; last_error: string | null; created_at: number;
}
const COLUMNS = 'id,name,color,url_enc,last_fetched_at,last_status,last_error,created_at'
// Exact original account role, generation and household, checked in every
// statement. A primary native batch supplies one atomic authority snapshot.
const AUTH = `EXISTS (SELECT 1 FROM "User" u JOIN "Family" f ON f.id=u.family_id
  WHERE u.id=?1 AND u.family_id=?2 AND u.role=?3 AND u.token_version=?4)`
const authority = `SELECT 1 AS admitted WHERE ${AUTH}`
function admitted(actor: CalendarSubscriptionActor, mode: Mode) {
  return Number.isSafeInteger(actor.generation) && actor.generation >= 0
    && (mode === 'read' || mode === 'refresh' ? ['parent', 'teen'] : ['parent']).includes(actor.role)
}
const args = (actor: CalendarSubscriptionActor): SqlValue[] => [actor.userId, actor.familyId, actor.role, actor.generation]
function dto(row: SubscriptionRow, actor: CalendarSubscriptionActor) {
  return toSubscriptionDto({ ...row, created_at: new Date(row.created_at),
    last_fetched_at: row.last_fetched_at === null ? null : new Date(row.last_fetched_at) }, { includeUrlHint: actor.role === 'parent' })
}
export async function renewD1CalendarSubscriptionActor(actor: CalendarSubscriptionActor, mode: Mode, database?: D1Store) {
  if (!admitted(actor, mode)) return false
  const db = (database ?? await getD1Database()).withSession('first-primary')
  return Boolean(await db.prepare(authority).bind(...args(actor)).first())
}
export async function listD1CalendarSubscriptions(actor: CalendarSubscriptionActor, database?: D1Store): Promise<Outcome<ReturnType<typeof dto>[]>> {
  if (!admitted(actor, 'read')) return { kind: 'held' }
  const db = (database ?? await getD1Database()).withSession('first-primary')
  const result = await db.batch<SubscriptionRow>([
    db.prepare(authority).bind(...args(actor)),
    db.prepare(`SELECT ${COLUMNS} FROM "CalendarSubscription" WHERE family_id=?2 AND ${AUTH}
      ORDER BY created_at,id LIMIT ?5`).bind(...args(actor), MAX_SUBSCRIPTIONS_PER_FAMILY),
  ])
  return result[0].results.length ? { kind: 'data', value: result[1].results.map(row => dto(row, actor)) } : { kind: 'held' }
}
/** URL encryption and bounded public-address validation stay at the HTTP boundary. */
export async function createD1CalendarSubscription(actor: CalendarSubscriptionActor,
  input: { name: string; color: string | null; url_enc: string }, database?: D1Store,
): Promise<Outcome<{ kind: 'full' } | { kind: 'created'; subscription: ReturnType<typeof dto> }>> {
  if (!admitted(actor, 'create')) return { kind: 'held' }
  const db = (database ?? await getD1Database()).withSession('first-primary')
  const id = randomUUID()
  const result = await db.batch<SubscriptionRow>([
    db.prepare(authority).bind(...args(actor)),
    db.prepare(`INSERT INTO "CalendarSubscription" (id,family_id,created_by,name,color,url_enc,last_status,created_at)
      SELECT ?5,?2,?1,?6,?7,?8,'pending',?9 WHERE ${AUTH}
      AND (SELECT COUNT(*) FROM "CalendarSubscription" WHERE family_id=?2)<?10`)
      .bind(...args(actor), id, input.name, input.color, input.url_enc, Date.now(), MAX_SUBSCRIPTIONS_PER_FAMILY),
    db.prepare(`SELECT ${COLUMNS} FROM "CalendarSubscription" WHERE id=?5 AND family_id=?2 AND ${AUTH}`).bind(...args(actor), id),
  ])
  if (!result[0].results.length) return { kind: 'held' }
  const row = result[2].results[0]
  return { kind: 'data', value: row ? { kind: 'created', subscription: dto(row, actor) } : { kind: 'full' } }
}
export async function updateD1CalendarSubscription(actor: CalendarSubscriptionActor, id: string,
  patch: { name?: string; color?: string | null }, database?: D1Store,
): Promise<Outcome<ReturnType<typeof dto> | null>> {
  if (!admitted(actor, 'manage')) return { kind: 'held' }
  const db = (database ?? await getD1Database()).withSession('first-primary')
  const values: SqlValue[] = []
  const columns: string[] = []
  for (const column of ['name', 'color'] as const) if (patch[column] !== undefined) {
    values.push(patch[column]!); columns.push(`"${column}"=?${5 + values.length}`)
  }
  const statements = [db.prepare(authority).bind(...args(actor))]
  if (columns.length) statements.push(db.prepare(`UPDATE "CalendarSubscription" SET ${columns.join(',')},updated_at=CAST(unixepoch('subsec') * 1000 AS INTEGER)
    WHERE id=?5 AND family_id=?2 AND ${AUTH}`).bind(...args(actor), id, ...values))
  statements.push(db.prepare(`SELECT ${COLUMNS} FROM "CalendarSubscription" WHERE id=?5 AND family_id=?2 AND ${AUTH}`).bind(...args(actor), id))
  const result = await db.batch<SubscriptionRow>(statements)
  const row = result.at(-1)!.results[0]
  return result[0].results.length ? { kind: 'data', value: row ? dto(row, actor) : null } : { kind: 'held' }
}
export async function deleteD1CalendarSubscription(actor: CalendarSubscriptionActor, id: string, database?: D1Store): Promise<Outcome<{ removedEvents: number } | null>> {
  if (!admitted(actor, 'manage')) return { kind: 'held' }
  const db = (database ?? await getD1Database()).withSession('first-primary')
  const result = await db.batch<{ id: string }>([
    db.prepare(authority).bind(...args(actor)),
    db.prepare(`DELETE FROM "Event" WHERE family_id=?2 AND source_subscription_id=?5 AND ${AUTH}
      AND EXISTS (SELECT 1 FROM "CalendarSubscription" WHERE id=?5 AND family_id=?2)`).bind(...args(actor), id),
    db.prepare(`DELETE FROM "CalendarSubscription" WHERE id=?5 AND family_id=?2 AND ${AUTH} RETURNING id`).bind(...args(actor), id),
  ])
  return result[0].results.length ? { kind: 'data', value: result[2].results.length ? { removedEvents: result[1].meta.changes } : null } : { kind: 'held' }
}
