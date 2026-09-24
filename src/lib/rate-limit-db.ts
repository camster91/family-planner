/**
 * Postgres-backed rate limiter. Survives across replicas and restarts.
 *
 * Uses a dedicated `RateLimitEntry` table to track request counts per key.
 * The first request from a key sets the window expiry; subsequent requests
 * increment the counter until either the window expires or `maxAttempts`
 * is reached.
 *
 * Falls back to in-memory storage when prisma isn't available (build, tests).
 */

import { prisma } from '@/lib/prisma'

export interface RateLimitResult {
  allowed: boolean
  retryAfterMs: number
  remaining: number
}

// In-memory fallback for when prisma isn't ready (build-time, tests)
const memStore = new Map<string, { count: number; resetAt: number }>()

function memCheck(
  key: string,
  maxAttempts: number,
  windowMs: number,
  now: number
): RateLimitResult {
  const entry = memStore.get(key)
  if (!entry || now > entry.resetAt) {
    memStore.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, retryAfterMs: 0, remaining: maxAttempts - 1 }
  }
  entry.count++
  if (entry.count > maxAttempts) {
    return { allowed: false, retryAfterMs: entry.resetAt - now, remaining: 0 }
  }
  return { allowed: true, retryAfterMs: 0, remaining: maxAttempts - entry.count }
}

export async function checkRateLimit(
  key: string,
  maxAttempts = 10,
  windowMs = 15 * 60 * 1000
): Promise<RateLimitResult> {
  const now = Date.now()

  // If prisma isn't ready (build-time, etc.) use the in-memory fallback
  if (!prisma) {
    return memCheck(key, maxAttempts, windowMs, now)
  }

  try {
    // Atomic path: `key` is UNIQUE, so this is a single
    // INSERT ... ON CONFLICT (key) DO UPDATE count = count + 1.
    // Concurrent requests serialize on the row and each gets its own count,
    // instead of racing findFirst/create/update past the limit.
    const entry = await prisma.rateLimitEntry.upsert({
      where: { key },
      create: {
        key,
        count: 1,
        windowStart: new Date(now),
        resetAt: new Date(now + windowMs),
      },
      update: { count: { increment: 1 } },
    })

    let count = entry.count
    let resetAt = entry.resetAt

    if (resetAt.getTime() <= now) {
      // The upsert resurrected an expired window — restart it. updateMany only
      // touches rows still carrying the expired resetAt, so a concurrent
      // request that already restarted the window is left alone; we then read
      // the fresh row instead of double-counting into a stale bucket.
      const refreshed = await prisma.rateLimitEntry.updateMany({
        where: { key, resetAt: { lte: new Date(now) } },
        data: {
          count: 1,
          windowStart: new Date(now),
          resetAt: new Date(now + windowMs),
        },
      })
      if (refreshed.count > 0) {
        count = 1
        resetAt = new Date(now + windowMs)
      } else {
        const fresh = await prisma.rateLimitEntry.findUnique({ where: { key } })
        if (fresh && fresh.resetAt.getTime() > now) {
          count = fresh.count
          resetAt = fresh.resetAt
        }
      }
    }

    if (count > maxAttempts) {
      return {
        allowed: false,
        retryAfterMs: resetAt.getTime() - now,
        remaining: 0,
      }
    }

    return {
      allowed: true,
      retryAfterMs: 0,
      remaining: maxAttempts - count,
    }
  } catch (err) {
    // If the rate_limit_entries table doesn't exist yet (older deployment
    // predating the table), or any other DB error, fail OPEN — allow the
    // request through. Rate limiting is a defense-in-depth measure; failing
    // closed would block every request until the table is created.
    // The migration script will create the table on next container start.
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('relation "RateLimitEntry" does not exist') ||
        msg.includes('does not exist')) {
      // First-time deploy — let it through, log once
      if (!(globalThis as any).__rlTableMissingWarned) {
        (globalThis as any).__rlTableMissingWarned = true
        console.warn('RateLimitEntry table missing — rate limiting disabled. Will activate on next deploy after migration runs.')
      }
    } else {
      console.warn('Rate limit DB query failed, using in-memory fallback:', err)
    }
    return memCheck(key, maxAttempts, windowMs, now)
  }
}

/**
 * Cleanup old rate limit entries. Call this from a cron job (or lazy on
 * each request) to prevent the table from growing unbounded.
 */
export async function cleanupRateLimits(): Promise<number> {
  if (!prisma) return 0
  const result = await prisma.rateLimitEntry.deleteMany({
    where: { resetAt: { lt: new Date() } },
  })
  return result.count
}

/**
 * Read-only check: is `key` currently over `maxAttempts`? Does not count as an
 * attempt. Used for failure-only limits (e.g. failed logins per account),
 * where only failures are recorded via checkRateLimit.
 */
export async function isRateLimited(key: string, maxAttempts: number): Promise<RateLimitResult> {
  const now = Date.now()
  let entry: { count: number; resetAt: number } | undefined

  if (prisma) {
    try {
      const row = await prisma.rateLimitEntry.findUnique({ where: { key } })
      if (row) entry = { count: row.count, resetAt: row.resetAt.getTime() }
    } catch {
      entry = memStore.get(key)
    }
  } else {
    entry = memStore.get(key)
  }

  if (entry && entry.resetAt > now && entry.count >= maxAttempts) {
    return { allowed: false, retryAfterMs: entry.resetAt - now, remaining: 0 }
  }
  const used = entry && entry.resetAt > now ? entry.count : 0
  return { allowed: true, retryAfterMs: 0, remaining: maxAttempts - used }
}

/** Forget a key's window, e.g. after a successful login. */
export async function resetRateLimit(key: string): Promise<void> {
  memStore.delete(key)
  if (!prisma) return
  try {
    await prisma.rateLimitEntry.deleteMany({ where: { key } })
  } catch {
    // Best effort: the window expires on its own.
  }
}
