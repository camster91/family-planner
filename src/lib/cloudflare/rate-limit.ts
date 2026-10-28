import { randomUUID } from 'node:crypto'
import type { RateLimitResult } from '@/lib/rate-limit-db'
import type { D1Store } from './database'

/** A single SQLite upsert resets or increments the window atomically. */
export async function checkD1RateLimit(
  db: D1Store, key: string, maxAttempts: number, windowMs: number, now: number,
): Promise<RateLimitResult> {
  const row = await db.withSession('first-primary').prepare(`
    INSERT INTO "RateLimitEntry" (id, key, count, windowStart, resetAt, created_at, updated_at)
    VALUES (?1, ?2, 1, ?3, ?4, ?3, ?3)
    ON CONFLICT(key) DO UPDATE SET
      count = CASE WHEN resetAt <= ?3 THEN 1 ELSE count + 1 END,
      windowStart = CASE WHEN resetAt <= ?3 THEN ?3 ELSE windowStart END,
      resetAt = CASE WHEN resetAt <= ?3 THEN ?4 ELSE resetAt END,
      updated_at = ?3
    RETURNING count, resetAt
  `).bind(randomUUID(), key, now, now + windowMs).first<{ count: number; resetAt: number }>()
  if (!row) throw new Error('D1 rate limit did not return a window')
  return {
    allowed: row.count <= maxAttempts,
    retryAfterMs: row.count > maxAttempts ? Math.max(0, row.resetAt - now) : 0,
    remaining: Math.max(0, maxAttempts - row.count),
  }
}

/** Failure-only counters are read from primary without incrementing them. */
export async function isD1RateLimited(db: D1Store, key: string, maxAttempts: number, now: number): Promise<RateLimitResult> {
  const row = await db.withSession('first-primary').prepare('SELECT count, resetAt FROM "RateLimitEntry" WHERE key = ?1')
    .bind(key).first<{ count: number; resetAt: number }>()
  const used = row && row.resetAt > now ? row.count : 0
  return {
    allowed: used < maxAttempts,
    retryAfterMs: used >= maxAttempts && row ? Math.max(0, row.resetAt - now) : 0,
    remaining: Math.max(0, maxAttempts - used),
  }
}
