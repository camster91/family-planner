/**
 * HTTP glue shared by the two deletion routes (`DELETE /api/users` for one
 * account, `DELETE /api/family` for the household): fresh authorization
 * (current password), typed confirmation, rate limit, Idempotency-Key and the
 * cleared session cookie. Contract: docs/product/ACCOUNT_DELETION.md.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyPassword } from '@/lib/auth'
import { checkRateLimit } from '@/lib/rate-limit-db'
import { withIdempotency, type EffectResult, type IdempotencyDb } from '@/lib/idempotency'
import { AccountDeletionError } from '@/lib/account-deletion'
import { confirmationMatches, type AccountDeletionCode } from '@/lib/account-deletion-shared'
import { QUEUE_RETIREMENT_HEADER } from '@/lib/queue-owner-contract'
import { queueHouseholdScope } from '@/lib/queue-owner-server'
import { storageBackend } from '@/lib/storage-backend'
import { getD1Database } from '@/lib/cloudflare/database'
import { findD1PasswordUser } from '@/lib/cloudflare/accounts'

/** Password attempts per member per window, across both deletion routes. */
const ATTEMPTS = 5
const WINDOW_MS = 15 * 60 * 1000

export function deletionError(status: number, code: AccountDeletionCode, error: string): NextResponse {
  return NextResponse.json({ error, code }, { status, headers: { 'Cache-Control': 'private, no-store' } })
}

/**
 * Re-authorize a destructive request: the member's current password and the
 * typed confirmation (`expected`). Returns an error response, or null to go on.
 */
export async function checkFreshAuthorization(
  userId: string,
  body: { password?: unknown; confirmation?: unknown },
  expected: string
): Promise<NextResponse | null> {
  if (typeof body.password !== 'string' || body.password.length === 0) {
    return deletionError(400, 'PASSWORD_REQUIRED', 'Enter your password to continue.')
  }
  if (!confirmationMatches(body.confirmation, expected)) {
    return deletionError(400, 'CONFIRMATION_MISMATCH', `Type ${expected} exactly to confirm.`)
  }
  const limit = await checkRateLimit(`account-delete:${userId}`, ATTEMPTS, WINDOW_MS)
  if (!limit.allowed) {
    const res = deletionError(429, 'RATE_LIMITED', 'Too many attempts. Try again later.')
    res.headers.set('Retry-After', String(Math.max(1, Math.ceil(limit.retryAfterMs / 1000))))
    return res
  }
  const user = storageBackend() === 'd1'
    ? await findD1PasswordUser(await getD1Database(), userId)
    : await prisma!.user.findUnique({ where: { id: userId }, select: { password: true } })
  if (!user?.password || !(await verifyPassword(body.password, user.password))) {
    return deletionError(400, 'INVALID_PASSWORD', 'That password is not right.')
  }
  return null
}

/** Common successful destructive-response headers/cookie for the native path.
 * Native D1 cannot use the Prisma idempotency wrapper because the User and
 * household rows are removed by the same batch. */
export function nativeDeletionResponse(opts: { userId: string; familyId: string | null; action: 'account.delete' | 'household.delete' }, body: unknown, status = 200): NextResponse {
  const response = NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })
  if (status >= 200 && status < 300) {
    response.headers.set(QUEUE_RETIREMENT_HEADER, JSON.stringify([
      { mode: 'generation', ownerId: opts.userId, throughGeneration: Number.MAX_SAFE_INTEGER },
      ...(opts.action === 'household.delete' && opts.familyId ? [{ mode: 'household', householdScope: queueHouseholdScope(opts.familyId) }] : []),
    ]))
    response.cookies.set('session_token', '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 0 })
  }
  return response
}

/**
 * The deletion removes the member's own idempotency records (and, for a
 * household, every record of it), including the in-progress row guarding this
 * request, so storing the outcome afterwards has nothing to update. This view
 * turns that final update into an `updateMany` that quietly matches nothing,
 * instead of an error per successful deletion. A retry with the same key is
 * then answered by authentication (401: the account is gone), which the
 * Settings dialog treats as "already deleted".
 */
function deletionIdempotencyDb(): IdempotencyDb {
  const records = prisma!.idempotencyRecord
  return {
    idempotencyRecord: {
      create: (args: any) => records.create(args),
      findFirst: (args: any) => records.findFirst(args),
      findMany: (args: any) => records.findMany(args),
      updateMany: (args: any) => records.updateMany(args),
      deleteMany: (args: any) => records.deleteMany(args),
      update: (async (args: any) => {
        await records.updateMany({ where: { id: args.where.id }, data: args.data })
        return {}
      }) as any,
    },
  } as IdempotencyDb
}

/**
 * Run a deletion effect, once per Idempotency-Key when the member has a
 * household (records are household-scoped), and clear the session cookie on
 * success. `hashBody` must not contain the password.
 */
export async function runDeletion(
  opts: {
    key: string | null
    userId: string
    familyId: string | null
    action: 'account.delete' | 'household.delete'
    hashBody: unknown
  },
  effect: () => Promise<EffectResult>
): Promise<NextResponse> {
  const guarded = async (): Promise<EffectResult> => {
    try {
      return await effect()
    } catch (error) {
      if (error instanceof AccountDeletionError) {
        return { status: error.status, body: { error: error.message, code: error.code } }
      }
      throw error
    }
  }
  const response =
    opts.key && opts.familyId
      ? await withIdempotency(
          deletionIdempotencyDb(),
          opts.key,
          { scope: `user:${opts.userId}`, familyId: opts.familyId, userId: opts.userId, action: opts.action },
          opts.hashBody,
          guarded
        )
      : await (async () => {
          const result = await guarded()
          return NextResponse.json(result.body, { status: result.status })
        })()
  response.headers.set('Cache-Control', 'private, no-store')
  if (response.status >= 200 && response.status < 300) {
    // A permanently erased User ID is never reassigned by registration.
    // This only retires that actor's journals, not another account's data.
    response.headers.set(QUEUE_RETIREMENT_HEADER, JSON.stringify([
      { mode: 'generation', ownerId: opts.userId, throughGeneration: Number.MAX_SAFE_INTEGER },
      ...(opts.action === 'household.delete' && opts.familyId ? [{ mode: 'household', householdScope: queueHouseholdScope(opts.familyId) }] : []),
    ]))
    // Attributes match the ones set at login, or the browser keeps the old cookie.
    response.cookies.set('session_token', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    })
  }
  return response
}
