/**
 * Commit and undo for the review-first event import (#270).
 *
 * The reviewed events are created here, server-side, in one transaction,
 * under `withIdempotency` (the client sends one `Idempotency-Key` per batch),
 * so a retry after a lost response replays the original result instead of
 * creating the events twice. The response carries an undo token: an HMAC
 * (key derived from JWT_SECRET with a purpose label) over the user, household,
 * event ids and commit time. Undo accepts only that token, so it can remove
 * exactly the events of one import made by the caller in the last 10 minutes;
 * it can never be pointed at an event created by hand through
 * `POST /api/events` (whose delete stays parent-only).
 */
import crypto from 'crypto'
import { z } from 'zod'
import type { Prisma, PrismaClient } from '@prisma/client'
import { getJwtSecret } from '@/lib/auth'
import { createEventSchema } from '@/lib/validations'
import type { EffectResult } from '@/lib/idempotency'
import { EVENT_IMPORT_MAX_SUGGESTIONS, EVENT_IMPORT_UNDO_WINDOW_MS } from '@/lib/event-import'

/** Idempotency action name; part of the stored request hash. */
export const EVENT_IMPORT_COMMIT_ACTION = 'calendar.import-commit'
/** Activity type of one committed import; its metadata lets a crashed commit converge. */
export const EVENT_IMPORT_ACTIVITY_TYPE = 'events_imported'

/** One reviewed event: the same field rules as `POST /api/events` (no type or recurrence). */
export const commitEventSchema = createEventSchema
  .pick({ title: true, description: true, start_time: true, end_time: true, location: true })
  .strict()

export const commitSchema = z
  .object({ events: z.array(commitEventSchema).min(1).max(EVENT_IMPORT_MAX_SUGGESTIONS) })
  .strict()

export type CommitInput = z.infer<typeof commitSchema>

export const undoSchema = z.object({ token: z.string().min(1).max(4096) }).strict()

/**
 * The same range rules as `POST /api/events`: real instants, and an end (which
 * defaults to the start) not before the start. Returns the first problem.
 */
export function checkCommitRanges(input: CommitInput): string | null {
  for (const [i, e] of input.events.entries()) {
    const start = new Date(e.start_time)
    const end = e.end_time ? new Date(e.end_time) : start
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return `Event ${i + 1}: invalid start or end time`
    if (end < start) return `Event ${i + 1}: end time must be after start time`
  }
  return null
}

// ---------------------------------------------------------------------------
// Undo token

const TOKEN_VERSION = 'v1'
/** Allowed clock skew for a token time slightly in the future (multiple app instances). */
const FUTURE_SKEW_MS = 60 * 1000

function tokenKey(): Buffer {
  // Purpose-bound key: never usable as, or derivable from, a session JWT signature.
  return crypto.createHmac('sha256', getJwtSecret()).update('family-planner:event-import-undo:v1').digest()
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url')
}

export interface UndoClaims {
  userId: string
  familyId: string
  eventIds: string[]
  /** Commit time, ms since epoch. */
  createdAt: number
}

export function signUndoToken(claims: UndoClaims): string {
  const payload = b64url(
    JSON.stringify({ u: claims.userId, f: claims.familyId, e: [...claims.eventIds].sort(), t: claims.createdAt })
  )
  const mac = crypto.createHmac('sha256', tokenKey()).update(`${TOKEN_VERSION}.${payload}`).digest()
  return `${TOKEN_VERSION}.${payload}.${b64url(mac)}`
}

export type UndoTokenCheck =
  | { ok: true; eventIds: string[]; createdAt: number }
  | { ok: false; reason: 'invalid' | 'expired' }

/**
 * Verify the MAC (constant time), that the token was issued to this user in
 * this household, and the 10-minute window. Any tampering, another person's
 * token or a malformed value is `invalid`.
 */
export function verifyUndoToken(
  token: string,
  actor: { userId: string; familyId: string },
  now: number = Date.now()
): UndoTokenCheck {
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return { ok: false, reason: 'invalid' }
  const expected = crypto.createHmac('sha256', tokenKey()).update(`${parts[0]}.${parts[1]}`).digest()
  let given: Buffer
  try {
    given = Buffer.from(parts[2], 'base64url')
  } catch {
    return { ok: false, reason: 'invalid' }
  }
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return { ok: false, reason: 'invalid' }

  let claims: { u?: unknown; f?: unknown; e?: unknown; t?: unknown }
  try {
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
  } catch {
    return { ok: false, reason: 'invalid' }
  }
  const ids = claims.e
  if (
    claims.u !== actor.userId ||
    claims.f !== actor.familyId ||
    typeof claims.t !== 'number' ||
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > EVENT_IMPORT_MAX_SUGGESTIONS ||
    !ids.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 128)
  ) {
    return { ok: false, reason: 'invalid' }
  }
  if (claims.t > now + FUTURE_SKEW_MS) return { ok: false, reason: 'invalid' }
  if (now - claims.t > EVENT_IMPORT_UNDO_WINDOW_MS) return { ok: false, reason: 'expired' }
  return { ok: true, eventIds: ids as string[], createdAt: claims.t }
}

// ---------------------------------------------------------------------------
// Commit

export interface CommitResponse {
  eventIds: string[]
  count: number
  undoToken: string
  /** ISO time after which Undo is refused. */
  undoExpiresAt: string
}

export interface CommitActor {
  id: string
  family_id: string
  name: string
}

type CommitDb = Pick<PrismaClient, '$transaction' | 'activity'>

function responseFor(actor: CommitActor, eventIds: string[], createdAt: number): EffectResult {
  const body: CommitResponse = {
    eventIds,
    count: eventIds.length,
    undoToken: signUndoToken({ userId: actor.id, familyId: actor.family_id, eventIds, createdAt }),
    undoExpiresAt: new Date(createdAt + EVENT_IMPORT_UNDO_WINDOW_MS).toISOString(),
  }
  return { status: 201, body }
}

/**
 * Create the reviewed events and one activity row, atomically. `requestId` is
 * the idempotency record id: if an earlier run of the same record committed
 * but its response was never stored (a crash between the two), the activity
 * row is found and the same result is returned instead of creating again.
 */
export async function commitImportedEvents(
  db: CommitDb,
  input: CommitInput,
  actor: CommitActor,
  requestId: string,
  now: Date = new Date()
): Promise<EffectResult> {
  const marker = `"requestId":${JSON.stringify(requestId)}`
  const earlier = await db.activity.findFirst({
    where: {
      family_id: actor.family_id,
      user_id: actor.id,
      type: EVENT_IMPORT_ACTIVITY_TYPE,
      metadata: { contains: marker },
    },
    select: { metadata: true },
  })
  if (earlier?.metadata) {
    try {
      const meta = JSON.parse(earlier.metadata) as { eventIds?: unknown; createdAt?: unknown }
      if (Array.isArray(meta.eventIds) && typeof meta.createdAt === 'number') {
        return responseFor(actor, meta.eventIds as string[], meta.createdAt)
      }
    } catch {
      // Fall through: an unreadable marker is treated as absent.
    }
  }

  const createdAt = now.getTime()
  const eventIds = await db.$transaction(async (tx: Prisma.TransactionClient) => {
    const ids: string[] = []
    for (const e of input.events) {
      const start = new Date(e.start_time)
      const end = e.end_time ? new Date(e.end_time) : start
      const created = await tx.event.create({
        data: {
          family_id: actor.family_id,
          title: e.title,
          description: e.description || null,
          start_time: start,
          end_time: end,
          location: e.location || null,
          event_type: 'other',
          created_by: actor.id,
        },
        select: { id: true },
      })
      ids.push(created.id)
    }
    const n = ids.length
    await tx.activity.create({
      data: {
        family_id: actor.family_id,
        user_id: actor.id,
        type: EVENT_IMPORT_ACTIVITY_TYPE,
        title: `${actor.name} imported ${n} event${n === 1 ? '' : 's'} to the calendar`,
        // requestId first so the `contains` marker above matches exactly this shape.
        metadata: JSON.stringify({ requestId, eventIds: ids, createdAt }),
      },
    })
    return ids
  })
  return responseFor(actor, eventIds, createdAt)
}
