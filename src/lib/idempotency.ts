/**
 * Server idempotency for retryable mutations (#162).
 * Contract: docs/architecture/API_CONTRACTS.md "Idempotency" and
 * docs/architecture/OFFLINE_SYNC.md.
 *
 * A route authenticates first, validates its body, then hands the effect to
 * `withIdempotency`. With no `Idempotency-Key` header the effect simply runs
 * (older clients keep working). With a key:
 *
 * 1. An in-progress `IdempotencyRecord` is inserted for (scope, key) BEFORE the
 *    effect runs. The unique index is the lock, so two concurrent duplicates
 *    cannot both run the effect.
 * 2. The loser of that race reads the existing row:
 *    - different action, request hash or household -> 422 IDEMPOTENCY_KEY_REUSED;
 *    - completed -> the stored status and body are replayed
 *      (`Idempotency-Replayed: true`), the effect does not run again;
 *    - still running -> 409 IDEMPOTENCY_IN_PROGRESS (retryable, Retry-After);
 *    - running for longer than the lock timeout (the first request died) ->
 *      taken over and run again. Only reached after a crash; the allowlisted
 *      actions set explicit state, so a second run converges.
 *    An expired row (older than the retention) is deleted and the key starts over.
 * 3. Only a 2xx outcome is stored. Any other outcome deletes the in-progress
 *    row so the same key can be retried after a transient error.
 *
 * `scope` is `user:<userId>` for a person session. Keys are therefore never
 * shared between users, and a record is never replayed into another household.
 * Authentication always runs before this helper, so a logged-out or revoked
 * session gets 401 and never reaches a stored response.
 *
 * Retention: 7 days. Expired rows are pruned opportunistically (a small random
 * share of keyed requests deletes them); there is no cron (AGENTS.md).
 */
import crypto from 'crypto'
import { NextResponse } from 'next/server'
import type { PrismaClient } from '@prisma/client'
import { IDEMPOTENCY_HEADER, IDEMPOTENCY_REPLAYED_HEADER, isValidIdempotencyKey } from '@/lib/idempotency-key'

export const IDEMPOTENCY_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** An in-progress row older than this is treated as abandoned (the first request died). */
export const IDEMPOTENCY_LOCK_TIMEOUT_MS = 30 * 1000
/** Stored response bodies larger than this (serialised) are replaced by `{ success: true }`. */
export const IDEMPOTENCY_MAX_BODY_CHARS = 8 * 1024
/** Share of keyed requests that also delete expired rows. */
export const IDEMPOTENCY_PRUNE_PROBABILITY = 0.05

/** Replaceable for tests; production uses the wall clock and Math.random. */
export const idempotencyRuntime = {
  now: (): Date => new Date(),
  random: (): number => Math.random(),
}

export type IdempotencyErrorCode = 'IDEMPOTENCY_KEY_INVALID' | 'IDEMPOTENCY_KEY_REUSED' | 'IDEMPOTENCY_IN_PROGRESS'

const MESSAGES: Record<IdempotencyErrorCode, string> = {
  IDEMPOTENCY_KEY_INVALID: 'The Idempotency-Key header is not valid.',
  IDEMPOTENCY_KEY_REUSED: 'This Idempotency-Key was already used for a different request.',
  IDEMPOTENCY_IN_PROGRESS: 'The original request with this Idempotency-Key is still being processed.',
}

export function idempotencyError(code: IdempotencyErrorCode): NextResponse {
  const status = code === 'IDEMPOTENCY_KEY_INVALID' ? 400 : code === 'IDEMPOTENCY_KEY_REUSED' ? 422 : 409
  const retryable = code === 'IDEMPOTENCY_IN_PROGRESS'
  const headers: Record<string, string> = { 'Cache-Control': 'private, no-store' }
  if (retryable) headers['Retry-After'] = '1'
  return NextResponse.json({ error: { code, message: MESSAGES[code], retryable } }, { status, headers })
}

/** Result of a route's effect, turned into a response by the helper. */
export interface EffectResult {
  status: number
  body: unknown
}

export interface IdempotencyContext {
  /** `user:<userId>` for a person session. */
  scope: string
  familyId: string
  userId: string | null
  /** Fixed action name, e.g. `list-item.update`. Part of the request hash. */
  action: string
}

type RecordDelegate = Pick<PrismaClient['idempotencyRecord'], 'create' | 'findFirst' | 'update' | 'updateMany' | 'deleteMany'>
export type IdempotencyDb = { idempotencyRecord: RecordDelegate }

/**
 * Reads the optional `Idempotency-Key` header. `key: null` without an error
 * means the client sent none; an invalid value is a 400.
 */
export function readIdempotencyKey(request: { headers: Headers }): { key: string | null; error: NextResponse | null } {
  const raw = request.headers.get(IDEMPOTENCY_HEADER)
  if (raw === null) return { key: null, error: null }
  const value = raw.trim()
  if (!isValidIdempotencyKey(value)) return { key: null, error: idempotencyError('IDEMPOTENCY_KEY_INVALID') }
  return { key: value, error: null }
}

/** Key-order-independent JSON, so `{a,b}` and `{b,a}` hash the same. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
}

export function hashIdempotentRequest(action: string, body: unknown): string {
  return crypto.createHash('sha256').update(`${action}\n${canonical(body)}`).digest('hex')
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === 'P2002')
}

function respond(result: EffectResult, replayed = false): NextResponse {
  const headers: Record<string, string> = {}
  if (replayed) headers[IDEMPOTENCY_REPLAYED_HEADER] = 'true'
  return NextResponse.json(result.body, { status: result.status, headers })
}

function storableBody(body: unknown): unknown {
  try {
    const text = JSON.stringify(body ?? null)
    if (body !== null && body !== undefined && text.length <= IDEMPOTENCY_MAX_BODY_CHARS) return JSON.parse(text)
  } catch {
    // Not serialisable: fall through to the minimal body.
  }
  return { success: true }
}

async function maybePrune(db: IdempotencyDb, now: Date): Promise<void> {
  if (idempotencyRuntime.random() >= IDEMPOTENCY_PRUNE_PROBABILITY) return
  try {
    await db.idempotencyRecord.deleteMany({ where: { expires_at: { lt: now } } })
  } catch (error) {
    // Pruning is housekeeping; it must never fail the request.
    console.error('Idempotency prune failed:', error instanceof Error ? error.message : 'unknown error')
  }
}

/**
 * Run `effect` at most once per (scope, key) while the record lives.
 * `body` is the validated request body; it is hashed, never stored.
 */
export async function withIdempotency(
  db: IdempotencyDb,
  key: string | null,
  ctx: IdempotencyContext,
  body: unknown,
  effect: () => Promise<EffectResult>
): Promise<NextResponse> {
  if (!key) return respond(await effect())

  const now = idempotencyRuntime.now()
  await maybePrune(db, now)
  const requestHash = hashIdempotentRequest(ctx.action, body)

  let recordId: string | null = null
  // Two passes at most: the second only after an expired row was removed.
  for (let pass = 0; pass < 2 && !recordId; pass++) {
    try {
      const created = await db.idempotencyRecord.create({
        data: {
          scope: ctx.scope,
          key,
          family_id: ctx.familyId,
          user_id: ctx.userId,
          action: ctx.action,
          request_hash: requestHash,
          created_at: now,
          expires_at: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
        },
        select: { id: true },
      })
      recordId = created.id
      break
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
    }

    const existing = await db.idempotencyRecord.findFirst({
      where: { scope: ctx.scope, key },
      select: {
        id: true,
        family_id: true,
        action: true,
        request_hash: true,
        response_status: true,
        response_body: true,
        created_at: true,
        expires_at: true,
      },
    })
    if (!existing) continue // Deleted between our insert and read: try again.

    if (existing.expires_at.getTime() <= now.getTime()) {
      await db.idempotencyRecord.deleteMany({ where: { id: existing.id, expires_at: { lte: now } } })
      continue
    }
    if (existing.family_id !== ctx.familyId || existing.action !== ctx.action || existing.request_hash !== requestHash) {
      return idempotencyError('IDEMPOTENCY_KEY_REUSED')
    }
    if (existing.response_status != null) {
      return respond({ status: existing.response_status, body: existing.response_body }, true)
    }
    if (existing.created_at.getTime() > now.getTime() - IDEMPOTENCY_LOCK_TIMEOUT_MS) {
      return idempotencyError('IDEMPOTENCY_IN_PROGRESS')
    }
    // Abandoned in-progress row: claim it with a compare-and-set on created_at
    // so only one of several concurrent takers wins.
    const claimed = await db.idempotencyRecord.updateMany({
      where: { id: existing.id, response_status: null, created_at: existing.created_at },
      data: { created_at: now },
    })
    if (claimed.count !== 1) return idempotencyError('IDEMPOTENCY_IN_PROGRESS')
    recordId = existing.id
  }
  if (!recordId) return idempotencyError('IDEMPOTENCY_IN_PROGRESS')

  let result: EffectResult
  try {
    result = await effect()
  } catch (error) {
    await release(db, recordId)
    throw error
  }

  if (result.status >= 200 && result.status < 300) {
    try {
      await db.idempotencyRecord.update({
        where: { id: recordId },
        data: { response_status: result.status, response_body: storableBody(result.body) as object },
      })
    } catch (error) {
      // The effect is committed; answer with it. A retry sees the in-progress
      // row (409) until the lock timeout, then re-runs the convergent effect.
      console.error('Idempotency store failed:', error instanceof Error ? error.message : 'unknown error')
    }
  } else {
    await release(db, recordId)
  }
  return respond(result)
}

async function release(db: IdempotencyDb, recordId: string): Promise<void> {
  try {
    await db.idempotencyRecord.deleteMany({ where: { id: recordId, response_status: null } })
  } catch (error) {
    // The row then expires via the lock timeout; the client retries.
    console.error('Idempotency release failed:', error instanceof Error ? error.message : 'unknown error')
  }
}
