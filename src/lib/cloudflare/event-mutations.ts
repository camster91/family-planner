import { randomUUID } from 'node:crypto'
import { AssistantSourceRefused, readAssistantSourceProof, type AssistantSourceGuard } from '@/lib/assistant-source-proof'
import { d1AssistantSourceChecks } from './assistant-source'
import { readDeleteTargetProof, type DeleteTargetGuard } from '@/lib/assistant-delete-target'
import { d1EventDeleteTargetChecks } from './assistant-delete-target'
import type { Event } from '@prisma/client'
import type { z } from 'zod'
import type { createEventSchema } from '@/lib/validations'
import type { EffectResult } from '@/lib/idempotency'
import { hashIdempotentRequest } from '@/lib/idempotency-hash'
import { IDEMPOTENCY_TTL_MS, IDEMPOTENCY_LOCK_TIMEOUT_MS, IDEMPOTENCY_PRUNE_PROBABILITY } from '@/lib/idempotency-key'
import { normalizeFeatures, isFeatureEnabled } from '@/lib/feature-flags'
import { EVENT_READ_ONLY_CODE, EVENT_READ_ONLY_MESSAGE } from '@/lib/calendar-import/source'
import { getD1Database, type D1Store, type SqlValue } from './database'
import { d1WriteCheck, isD1WriteConflict } from './write-check'
import { pruneD1ExpiredReceipts } from './notification-preferences'

type Actor = { userId: string; familyId: string; generation: number; role?: string; name?: string }
type Mutation = { kind: 'create'; input: z.infer<typeof createEventSchema> } | { kind: 'delete'; eventId: string }
type Authority = { family_id: string | null; role: string; token_version: number; family_exists: string | null; features: string | null }
type Receipt = { id: string; family_id: string; action: string; request_hash: string; created_at: number; expires_at: number; response_status: number | null; response_body: string | null }
type Target = { id: string; family_id: string; source_subscription_id: string | null; schedule_generation: string; schedule_epoch: number; preparation_epoch: number; updated_at: number }
export class D1EventReceiptError extends Error {
  constructor(readonly code: 'IDEMPOTENCY_KEY_REUSED' | 'IDEMPOTENCY_IN_PROGRESS') { super(code) }
}
export type D1EventMutationResult = EffectResult & { replayed: boolean; created: boolean }
const failure = (status: number, error: string, code?: string): EffectResult => ({ status, body: { error, ...(code ? { code } : {}) } })
const result = (effect: EffectResult, replayed = false, created = false): D1EventMutationResult => ({ ...effect, replayed, created })
function refusal(row: Authority | null, actor: Actor, mutation: Mutation): EffectResult | null {
  if (!row || row.token_version !== actor.generation) return failure(401, 'Unauthorized')
  if (mutation.kind === 'delete' && (row.family_id !== actor.familyId || row.role !== actor.role)) return failure(401, 'Unauthorized')
  if (row.family_id !== actor.familyId || !['parent', 'teen', 'child'].includes(row.role) || (mutation.kind === 'delete' && row.role !== 'parent'))
    return failure(403, mutation.kind === 'delete' ? 'Only parents can perform this action' : 'This account cannot perform this calendar action in this household')
  if (!row.family_exists) return failure(404, 'Household not found')
  if (mutation.kind === 'delete' && !isFeatureEnabled(normalizeFeatures(row.features === null ? null : JSON.parse(row.features)), 'calendar'))
    return failure(403, 'This feature is turned off for your family')
  return null
}
/** Domain effects and their exact completed response commit together. An
 * abandoned legacy receipt is replaced only after an atomic snapshot check.
 * No public callback can execute arbitrary writes outside this native batch.
 */
export async function mutateD1Event(actor: Actor, mutation: Mutation, key: string | null, options: { now?: Date; database?: D1Store; sourceGuard?: AssistantSourceGuard; targetGuard?: DeleteTargetGuard } = {}): Promise<D1EventMutationResult> {
  if (mutation.kind === 'create' && typeof actor.name !== 'string') throw new Error('Event actor name unavailable')
  const database = options.database ?? await getD1Database()
  const db = database.withSession('first-primary')
  const guard = options.sourceGuard
  const guardActor = guard?.actor
  if (guard) {
    if ((mutation.kind === 'delete' && !options.targetGuard) || !guard.d1 || guard.d1.kind !== `event_${mutation.kind}` || !guardActor || actor.userId !== guardActor.userId || actor.familyId !== guardActor.familyId || actor.generation !== guardActor.generation || actor.role !== guardActor.role) throw new AssistantSourceRefused()
    readAssistantSourceProof(guard.d1.token, guardActor, guard.d1.kind)
  }
  const targetGuard = options.targetGuard
  const targetActor = { userId: actor.userId, familyId: actor.familyId, role: actor.role ?? '', generation: actor.generation }
  if (targetGuard) {
    if (mutation.kind !== 'delete' || !targetGuard.d1 || targetGuard.d1.kind !== 'event_delete' || targetGuard.d1.targetId !== mutation.eventId) throw new AssistantSourceRefused()
    readDeleteTargetProof(targetGuard.d1.token, targetActor, 'event_delete', mutation.eventId)
  }
  const renewSourceOwner = (current: Authority | null) => {
    if (guardActor && (!current || current.family_id !== guardActor.familyId || current.role !== guardActor.role || current.token_version !== guardActor.generation)) throw new AssistantSourceRefused()
  }
  const now = (options.now ?? new Date()).getTime(), scope = `user:${actor.userId}`
  const action = `event.${mutation.kind}`
  const input = mutation.kind === 'create' ? mutation.input : { eventId: mutation.eventId }
  const hash = hashIdempotentRequest(action, input)
  const readAuthority = () => db.prepare(`SELECT u.family_id,u.role,u.token_version,f.id AS family_exists,f.features
    FROM "User" u LEFT JOIN "Family" f ON f.id=?2 WHERE u.id=?1`).bind(actor.userId, actor.familyId).first<Authority>()
  let prune = key !== null && Math.random() < IDEMPOTENCY_PRUNE_PROBABILITY
  for (let attempt = 0; attempt < 16; attempt++) {
    const authority = await readAuthority()
    renewSourceOwner(authority)
    const denied = refusal(authority, actor, mutation)
    if (denied) return result(denied)
    if (prune) { prune = false; try { await pruneD1ExpiredReceipts(db, now) } catch { console.warn('[idempotency] Expired receipt cleanup could not finish') } }
    const prior = key === null ? null : await db.prepare(`SELECT id,family_id,action,request_hash,created_at,expires_at,response_status,response_body
      FROM "IdempotencyRecord" WHERE scope=?1 AND key=?2`).bind(scope, key).first<Receipt>()
    if (prior && prior.expires_at > now) {
      if (prior.family_id !== actor.familyId || prior.action !== action || prior.request_hash !== hash) throw new D1EventReceiptError('IDEMPOTENCY_KEY_REUSED')
      if (prior.response_status !== null) {
        const current = await readAuthority()
        renewSourceOwner(current)
        const currentRefusal = refusal(current, actor, mutation)
        if (currentRefusal) return result(currentRefusal)
        try { return result({ status: prior.response_status, body: JSON.parse(prior.response_body!) }, true) }
        catch { throw new D1EventReceiptError('IDEMPOTENCY_IN_PROGRESS') }
      }
      if (prior.created_at > now - IDEMPOTENCY_LOCK_TIMEOUT_MS) throw new D1EventReceiptError('IDEMPOTENCY_IN_PROGRESS')
    }
    const statements = [d1WriteCheck(db, `EXISTS (SELECT 1 FROM "User" u JOIN "Family" f ON f.id=u.family_id
      WHERE u.id=?1 AND u.family_id=?2 AND u.token_version=?3 AND u.role=?4${mutation.kind === 'delete' ? ' AND f.features IS ?5' : ''})`,
    [actor.userId, actor.familyId, actor.generation, authority!.role, ...(mutation.kind === 'delete' ? [authority!.features] : [])])]
    try {
      if (guard && guardActor) {
        const source = await d1AssistantSourceChecks(database, guardActor, `event_${mutation.kind}`, guard)
        statements.push(...source.checks(db))
      }
      if (targetGuard && mutation.kind === 'delete') {
        const target = await d1EventDeleteTargetChecks(database, targetActor, mutation.eventId, targetGuard)
        statements.push(...target.checks(db))
      }
    } catch (cause) {
      // A competing same-key effect may commit after our receipt lookup and
      // before proof reads (especially deletion of the reviewed target). Its
      // effect and receipt are atomic. Re-enter the ordinary replay path with
      // renewed authority; never bypass a stale proof without that receipt.
      if (cause instanceof AssistantSourceRefused && key !== null) {
        const settled = await db.prepare(`SELECT id FROM "IdempotencyRecord" WHERE scope=?1 AND key=?2 AND family_id=?3
          AND action=?4 AND request_hash=?5 AND response_status IS NOT NULL AND expires_at>?6`)
          .bind(scope, key, actor.familyId, action, hash, now).first()
        if (settled) continue
      }
      throw cause
    }
    if (key !== null) {
      if (prior) {
        statements.push(d1WriteCheck(db, `EXISTS (SELECT 1 FROM "IdempotencyRecord" WHERE id=?1 AND scope=?2 AND key=?3
          AND (expires_at<=?4 OR (family_id=?5 AND action=?6 AND request_hash=?7 AND response_status IS NULL AND created_at=?8 AND created_at<=?9)))`,
        [prior.id, scope, key, now, actor.familyId, action, hash, prior.created_at, now - IDEMPOTENCY_LOCK_TIMEOUT_MS]))
        statements.push(db.prepare('DELETE FROM "IdempotencyRecord" WHERE id=?1').bind(prior.id))
      }
      statements.push(d1WriteCheck(db, 'NOT EXISTS (SELECT 1 FROM "IdempotencyRecord" WHERE scope=?1 AND key=?2)', [scope, key]))
    }
    let effect: EffectResult
    if (mutation.kind === 'create') {
      const value = mutation.input
      const event: Event = { id: randomUUID(), family_id: actor.familyId, created_by: actor.userId,
        title: value.title, description: value.description || null, location: value.location || null,
        start_time: new Date(value.start_time), end_time: new Date(value.end_time || value.start_time), event_type: value.event_type,
        recurrence: value.recurrence || null, created_at: new Date(now), updated_at: new Date(now),
        preparation_epoch: 0, schedule_generation: randomUUID(), schedule_epoch: 0, is_task: false, project_id: null,
        source_subscription_id: null, source_uid: null, source_occurrence_start: null, source_connection_id: null }
      effect = { status: 200, body: JSON.parse(JSON.stringify({ event })) }
      statements.push(db.prepare(`INSERT INTO "Event" (id,family_id,created_by,title,description,location,start_time,end_time,event_type,recurrence,created_at,updated_at,schedule_generation)
        VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?11,?12)`)
        .bind(event.id, actor.familyId, actor.userId, event.title, event.description, event.location, event.start_time.getTime(), event.end_time.getTime(), event.event_type, event.recurrence, now, event.schedule_generation))
      statements.push(db.prepare(`INSERT INTO "Activity" (id,family_id,user_id,type,title,metadata,created_at) VALUES (?1,?2,?3,'event_created',?4,?5,?6)`)
        .bind(randomUUID(), actor.familyId, actor.userId, `${actor.name} added "${event.title}" to the calendar`, JSON.stringify({ eventId: event.id }), now))
    } else {
      const target = await db.prepare(`SELECT id,family_id,source_subscription_id,schedule_generation,schedule_epoch,preparation_epoch,updated_at FROM "Event" WHERE id=?1`).bind(mutation.eventId).first<Target>()
      const ineligible = !target ? failure(404, 'Event not found') : target.family_id !== actor.familyId ? failure(403, 'Forbidden')
        : target.source_subscription_id ? failure(409, EVENT_READ_ONLY_MESSAGE, EVENT_READ_ONLY_CODE) : null
      if (ineligible) {
        // Renew authority and release any reclaimable/expired legacy key even
        // for an error outcome. This batch has no canonical event effect.
        try { await db.batch(statements); return result(ineligible) }
        catch (cause) { if (isD1WriteConflict(cause)) continue; throw cause }
      }
      const targetValues: SqlValue[] = [target!.id, actor.familyId, target!.schedule_generation, target!.schedule_epoch, target!.preparation_epoch, target!.updated_at]
      statements.push(d1WriteCheck(db, `EXISTS (SELECT 1 FROM "Event" WHERE id=?1 AND family_id=?2 AND schedule_generation=?3
        AND schedule_epoch=?4 AND preparation_epoch=?5 AND updated_at=?6 AND (source_subscription_id IS NULL OR source_subscription_id=''))`, targetValues))
      statements.push(db.prepare('DELETE FROM "Event" WHERE id=?1 AND family_id=?2').bind(target!.id, actor.familyId))
      statements.push(d1WriteCheck(db, 'changes()=1'))
      effect = { status: 200, body: { success: true } }
    }
    if (key !== null) statements.push(db.prepare(`INSERT INTO "IdempotencyRecord" (id,scope,key,family_id,user_id,action,request_hash,response_status,response_body,created_at,expires_at)
      VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)`)
      .bind(prior && prior.expires_at > now ? prior.id : randomUUID(), scope, key, actor.familyId, actor.userId, action, hash,
        effect.status, JSON.stringify(effect.body), now, prior && prior.expires_at > now ? prior.expires_at : now + IDEMPOTENCY_TTL_MS))
    try { await db.batch(statements); return result(effect, false, mutation.kind === 'create') }
    catch (cause) { if (!isD1WriteConflict(cause)) throw cause }
  }
  throw new D1EventReceiptError('IDEMPOTENCY_IN_PROGRESS')
}
