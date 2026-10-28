import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { getD1Database, type D1Store, type SqlValue } from './database'
import { d1WriteCheck, isD1WriteConflict } from './write-check'
import { hashIdempotentRequest } from '@/lib/idempotency-hash'
import { IDEMPOTENCY_TTL_MS, IDEMPOTENCY_LOCK_TIMEOUT_MS, IDEMPOTENCY_PRUNE_PROBABILITY } from '@/lib/idempotency-key'
import { NOTIFICATION_PREFERENCES_ACTION } from '@/lib/notification-policy'
import { notificationPreferencesBody, notificationPreferencesColumns, type NotificationPreferencePatch } from '@/lib/notification-preferences-values'

type Actor = { userId: string; familyId: string | null; generation: number }
const COLUMNS = ['notify_chores', 'notify_events', 'notify_messages', 'quiet_hours_enabled', 'quiet_hours_start', 'quiet_hours_end', 'quiet_hours_time_zone', 'morning_summary_enabled', 'morning_summary_time_zone'] as const
type Row = Record<typeof COLUMNS[number], SqlValue> & { family_id: string | null; token_version: number }
type Receipt = { id: string; family_id: string; action: string; request_hash: string; created_at: number; expires_at: number; response_status: number | null; response_body: string | null }
const SELECT = `SELECT family_id,token_version,${COLUMNS.map(c => `"${c}"`).join(',')} FROM "User" WHERE id=?1`
const receiptBody = z.object({ preferences: z.object({ chores: z.boolean(), events: z.boolean(), messages: z.boolean() }).strict(),
  quietHours: z.object({ enabled: z.boolean(), start: z.string(), end: z.string(), timeZone: z.string().nullable() }).strict(),
  morningSummary: z.object({ enabled: z.boolean(), timeZone: z.string().nullable() }).strict() }).strict()
export class D1NotificationPreferenceError extends Error {
  constructor(readonly code: 'UNAUTHORIZED' | 'FORBIDDEN' | 'IDEMPOTENCY_KEY_REUSED' | 'IDEMPOTENCY_IN_PROGRESS') { super(code) }
}
function authorized(row: Row | null, actor: Actor): Row {
  if (!row || row.token_version !== actor.generation) throw new D1NotificationPreferenceError('UNAUTHORIZED')
  if (row.family_id !== actor.familyId) throw new D1NotificationPreferenceError('FORBIDDEN')
  return row
}
function body(row: Row) {
  return notificationPreferencesBody({
    notify_chores: row.notify_chores === 1, notify_events: row.notify_events === 1, notify_messages: row.notify_messages === 1,
    quiet_hours_enabled: row.quiet_hours_enabled === 1, quiet_hours_start: row.quiet_hours_start as string, quiet_hours_end: row.quiet_hours_end as string, quiet_hours_time_zone: row.quiet_hours_time_zone as string | null,
    morning_summary_enabled: row.morning_summary_enabled === 1, morning_summary_time_zone: row.morning_summary_time_zone as string | null,
  })
}
export async function readD1NotificationPreferences(actor: Actor, database?: D1Store) {
  const db = (database ?? await getD1Database()).withSession('first-primary')
  return body(authorized(await db.prepare(SELECT).bind(actor.userId).first<Row>(), actor))
}
/** Same event-driven, globally bounded receipt retention as the legacy helper. */
export async function pruneD1ExpiredReceipts(db: Pick<D1Store, 'prepare'>, now: number) {
  await db.prepare(`DELETE FROM "IdempotencyRecord" WHERE id IN
    (SELECT id FROM "IdempotencyRecord" WHERE expires_at<?1 ORDER BY expires_at,id LIMIT 500)
    AND expires_at<?1`).bind(now).run()
}
/** Explicit own-state update and optional receipt commit in one native batch. */
export async function updateD1NotificationPreferences(actor: Actor, patch: NotificationPreferencePatch, key: string | null, now = new Date(), database?: D1Store) {
  const db = (database ?? await getD1Database()).withSession('first-primary')
  const scope = `user:${actor.userId}`, hash = hashIdempotentRequest(NOTIFICATION_PREFERENCES_ACTION, patch)
  const keyed = key !== null && actor.familyId !== null
  const columns = notificationPreferencesColumns(patch)
  const values: Array<[typeof COLUMNS[number], SqlValue]> = []
  for (const column of COLUMNS) {
    const value = (columns as Partial<Record<typeof COLUMNS[number], boolean | string | null>>)[column]
    if (value !== undefined) values.push([column, typeof value === 'boolean' ? Number(value) : value])
  }
  let housekeeping = keyed && Math.random() < IDEMPOTENCY_PRUNE_PROBABILITY
  for (let attempt = 0; attempt < 16; attempt++) {
    const current = authorized(await db.prepare(SELECT).bind(actor.userId).first<Row>(), actor)
    if (housekeeping) {
      housekeeping = false
      try { await pruneD1ExpiredReceipts(db, now.getTime()) }
      catch { console.warn('[idempotency] Expired receipt cleanup could not finish') }
    }
    const prior = keyed ? await db.prepare('SELECT id,family_id,action,request_hash,created_at,expires_at,response_status,response_body FROM "IdempotencyRecord" WHERE scope=?1 AND key=?2').bind(scope, key!).first<Receipt>() : null
    if (prior && prior.expires_at > now.getTime()) {
      if (prior.family_id !== actor.familyId || prior.action !== NOTIFICATION_PREFERENCES_ACTION || prior.request_hash !== hash) throw new D1NotificationPreferenceError('IDEMPOTENCY_KEY_REUSED')
      if (prior.response_status !== null) {
        const parsed = receiptBody.safeParse(prior.response_body === null ? null : JSON.parse(prior.response_body))
        if (!parsed.success || prior.response_status !== 200) throw new D1NotificationPreferenceError('IDEMPOTENCY_IN_PROGRESS')
        authorized(await db.prepare(SELECT).bind(actor.userId).first<Row>(), actor)
        return { body: parsed.data, replayed: true }
      }
      if (prior.created_at > now.getTime() - IDEMPOTENCY_LOCK_TIMEOUT_MS) throw new D1NotificationPreferenceError('IDEMPOTENCY_IN_PROGRESS')
    }
    const next = body({ ...current, ...Object.fromEntries(values) })
    const checks = [d1WriteCheck(db, `EXISTS(SELECT 1 FROM "User" WHERE id=?1 AND family_id IS ?2 AND token_version=?3 AND ${COLUMNS.map((c, i) => `"${c}" IS ?${i + 4}`).join(' AND ')})`, [actor.userId, actor.familyId, actor.generation, ...COLUMNS.map(c => current[c])])]
    if (keyed) {
      if (prior) {
        checks.push(d1WriteCheck(db, `EXISTS(SELECT 1 FROM "IdempotencyRecord" WHERE id=?1 AND scope=?2 AND key=?3 AND (expires_at<=?4 OR (family_id=?5 AND action=?6 AND request_hash=?7 AND response_status IS NULL AND created_at=?8 AND created_at<=?9)))`, [prior.id, scope, key!, now.getTime(), actor.familyId, NOTIFICATION_PREFERENCES_ACTION, hash, prior.created_at, now.getTime() - IDEMPOTENCY_LOCK_TIMEOUT_MS]))
        checks.push(db.prepare('DELETE FROM "IdempotencyRecord" WHERE id=?1').bind(prior.id))
      }
      checks.push(d1WriteCheck(db, 'NOT EXISTS(SELECT 1 FROM "IdempotencyRecord" WHERE scope=?1 AND key=?2)', [scope, key!]))
    }
    if (values.length) {
      checks.push(db.prepare(`UPDATE "User" SET ${values.map(([c], i) => `"${c}"=?${i + 4}`).join(',')} WHERE id=?1 AND family_id IS ?2 AND token_version=?3`).bind(actor.userId, actor.familyId, actor.generation, ...values.map(([, v]) => v)))
      checks.push(d1WriteCheck(db, 'changes()=1'))
    }
    if (keyed) checks.push(db.prepare(`INSERT INTO "IdempotencyRecord" (id,scope,key,family_id,user_id,action,request_hash,response_status,response_body,created_at,expires_at) VALUES (?1,?2,?3,?4,?5,?6,?7,200,?8,?9,?10)`)
      .bind(randomUUID(), scope, key!, actor.familyId, actor.userId, NOTIFICATION_PREFERENCES_ACTION, hash, JSON.stringify(next), now.getTime(), prior && prior.expires_at > now.getTime() ? prior.expires_at : now.getTime() + IDEMPOTENCY_TTL_MS))
    try { await db.batch(checks); return { body: next, replayed: false } }
    catch (error) { if (!isD1WriteConflict(error)) throw error }
  }
  throw new D1NotificationPreferenceError('IDEMPOTENCY_IN_PROGRESS')
}
