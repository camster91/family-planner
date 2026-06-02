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
    // Find an unexpired entry for this key
    const existing = await prisma.rateLimitEntry.findFirst({
      where: {
        key,
        resetAt: { gt: new Date(now) },
      },
    })

    if (!existing) {
      // No active window — create a new one
      await prisma.rateLimitEntry.create({
        data: {
          key,
          count: 1,
          windowStart: new Date(now),
          resetAt: new Date(now + windowMs),
        },
      })
      return { allowed: true, retryAfterMs: 0, remaining: maxAttempts - 1 }
    }

    // Increment the existing entry
    const newCount = existing.count + 1
    await prisma.rateLimitEntry.update({
      where: { id: existing.id },
      data: { count: newCount },
    })

    if (newCount > maxAttempts) {
      return {
        allowed: false,
        retryAfterMs: existing.resetAt.getTime() - now,
        remaining: 0,
      }
    }

    return {
      allowed: true,
      retryAfterMs: 0,
      remaining: maxAttempts - newCount,
    }
  } catch (err) {
    // If the rate_limit_entries table doesn't exist yet, fall back to in-memory
    // so the rest of the app continues to work.
    console.warn('Rate limit DB query failed, using in-memory fallback:', err)
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
