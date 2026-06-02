// Critical-path tests for Family Planner
// These run with `jest --passWithNoTests` so they're optional, but if they fail
// it usually means a regression that will break production.

// Mock next/server to avoid pulling in the full Next.js runtime
jest.mock('next/server', () => ({
  NextResponse: {
    json: (data: unknown, init?: ResponseInit) => ({
      status: init?.status || 200,
      json: async () => data,
      cookies: { set: jest.fn() },
    }),
    redirect: (url: URL | string) => ({
      status: 307,
      headers: { get: (k: string) => k === 'Location' ? url.toString() : null },
    }),
    next: () => ({
      headers: { set: jest.fn() },
    }),
  },
}))

import { signToken, verifyToken, hashPassword, verifyPassword, checkRateLimit } from '@/lib/auth'

describe('Auth', () => {
  describe('signToken / verifyToken', () => {
    const SECRET = process.env.JWT_SECRET || 'test-secret'

    beforeAll(() => {
      process.env.JWT_SECRET = SECRET
    })

    it('round-trips a valid payload', () => {
      const token = signToken({ userId: 'u1', email: 'a@b.com' })
      const decoded = verifyToken(token)
      expect(decoded).toEqual({ userId: 'u1', email: 'a@b.com' })
    })

    it('rejects garbage tokens', () => {
      expect(verifyToken('not-a-jwt')).toBeNull()
    })

    it('rejects tampered tokens', () => {
      const token = signToken({ userId: 'u1', email: 'a@b.com' })
      const tampered = token.slice(0, -3) + 'xyz'
      expect(verifyToken(tampered)).toBeNull()
    })
  })

  describe('hashPassword / verifyPassword', () => {
    it('hashes and verifies a password', async () => {
      const hash = await hashPassword('correct-horse-battery-staple')
      expect(hash).not.toBe('correct-horse-battery-staple')
      expect(await verifyPassword('correct-horse-battery-staple', hash)).toBe(true)
      expect(await verifyPassword('wrong', hash)).toBe(false)
    })

    it('safeVerifyPassword returns false for null hash', async () => {
      const { safeVerifyPassword } = await import('@/lib/auth')
      expect(await safeVerifyPassword('any', null)).toBe(false)
    })
  })

  describe('checkRateLimit', () => {
    it('allows up to maxAttempts', () => {
      const key = `test:${Date.now()}-${Math.random()}`
      for (let i = 0; i < 5; i++) {
        expect(checkRateLimit(key, 5, 60000).allowed).toBe(true)
      }
    })

    it('blocks after maxAttempts', () => {
      const key = `test:${Date.now()}-${Math.random()}`
      for (let i = 0; i < 3; i++) checkRateLimit(key, 3, 60000)
      const blocked = checkRateLimit(key, 3, 60000)
      expect(blocked.allowed).toBe(false)
      expect(blocked.retryAfterMs).toBeGreaterThan(0)
    })
  })
})

describe('Gamification (client-safe)', () => {
  const { calculateChoreXP, streakBonus, xpForNextLevel, DIFFICULTY_MULTIPLIER, BASE_XP } = require('@/lib/gamification')

  it('BASE_XP is 10 (default chore points)', () => {
    expect(BASE_XP).toBe(10)
  })

  it('easy difficulty has 1x multiplier', () => {
    expect(DIFFICULTY_MULTIPLIER.easy).toBe(1)
  })

  it('hard difficulty has 2x multiplier', () => {
    expect(DIFFICULTY_MULTIPLIER.hard).toBe(2)
  })

  it('streak bonus caps at 100% (10 days)', () => {
    expect(streakBonus(0)).toBe(1.0)
    expect(streakBonus(5)).toBeCloseTo(1.5)
    expect(streakBonus(10)).toBe(2.0)
    expect(streakBonus(100)).toBe(2.0) // cap
  })

  it('calculateChoreXP respects difficulty + streak', () => {
    // 10 base * 2.0 (hard) * 1.0 (no streak) = 20
    expect(calculateChoreXP('hard', 0, 10)).toBe(20)
    // 10 base * 1.5 (medium) * 1.5 (5-day streak) = 23 (rounded)
    expect(calculateChoreXP('medium', 5, 10)).toBe(23)
  })

  it('xpForNextLevel scales with level', () => {
    expect(xpForNextLevel(1)).toBe(100)
    expect(xpForNextLevel(5)).toBe(500)
  })
})

describe('Validations', () => {
  const { createRewardSchema, registerSchema, loginSchema, completeChoreSchema } = require('@/lib/validations')

  it('createRewardSchema accepts the new shape (name + cost, not title + point_cost)', () => {
    const result = createRewardSchema.safeParse({ name: 'Test', cost: 50, icon: '🎁' })
    expect(result.success).toBe(true)
  })

  it('createRewardSchema rejects old shape', () => {
    const result = createRewardSchema.safeParse({ title: 'Test', point_cost: 50 })
    expect(result.success).toBe(false)
  })

  it('registerSchema requires email, password, name', () => {
    expect(registerSchema.safeParse({ email: 'a@b.com', password: 'longenough', name: 'X' }).success).toBe(true)
    expect(registerSchema.safeParse({ email: 'a@b.com', password: 'short', name: 'X' }).success).toBe(false)
  })

  it('loginSchema requires email + password', () => {
    expect(loginSchema.safeParse({ email: 'a@b.com', password: 'x' }).success).toBe(true)
  })

  it('completeChoreSchema allows null photoUrl (regression test for nullable fix)', () => {
    const result = completeChoreSchema.safeParse({
      choreId: 'c1',
      photoUrl: null,
    })
    expect(result.success).toBe(true)
  })
})

describe('CSRF protection', () => {
  const { generateCsrfToken, validateCsrf } = require('@/lib/csrf')

  it('generateCsrfToken returns 64-char hex', () => {
    const token = generateCsrfToken()
    expect(token).toMatch(/^[a-f0-9]{64}$/)
  })

  it('generateCsrfToken returns different tokens each call', () => {
    const a = generateCsrfToken()
    const b = generateCsrfToken()
    expect(a).not.toBe(b)
  })

  it('validateCsrf returns null for GET (safe method)', () => {
    const req = { method: 'GET', cookies: { get: () => undefined }, headers: { get: () => null } } as any
    expect(validateCsrf(req)).toBeNull()
  })

  it('validateCsrf rejects POST without cookie', () => {
    const req = { method: 'POST', cookies: { get: () => undefined }, headers: { get: () => null } } as any
    const result = validateCsrf(req)
    expect(result).not.toBeNull()
    expect(result?.status).toBe(403)
  })

  it('validateCsrf rejects POST without header', () => {
    const req = {
      method: 'POST',
      cookies: { get: () => ({ value: 'abc' }) },
      headers: { get: () => null },
    } as any
    const result = validateCsrf(req)
    expect(result?.status).toBe(403)
  })

  it('validateCsrf rejects POST with mismatched token', () => {
    const token = 'a'.repeat(64)
    const wrong = 'b'.repeat(64)
    const req = {
      method: 'POST',
      cookies: { get: () => ({ value: token }) },
      headers: { get: () => wrong },
    } as any
    const result = validateCsrf(req)
    expect(result?.status).toBe(403)
  })

  it('validateCsrf accepts POST with matching token', () => {
    const token = generateCsrfToken()
    const req = {
      method: 'POST',
      cookies: { get: () => ({ value: token }) },
      headers: { get: () => token },
    } as any
    expect(validateCsrf(req)).toBeNull()
  })
})
