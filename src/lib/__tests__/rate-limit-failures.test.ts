jest.mock('@/lib/prisma', () => ({ prisma: undefined }))

import { checkRateLimit, isRateLimited, resetRateLimit } from '@/lib/rate-limit-db'

describe('failure-only rate limiting', () => {
  it('blocks once failures reach the limit without counting the check itself', async () => {
    const key = 'login-fail:kid@example.com'
    for (let i = 0; i < 3; i++) {
      expect((await isRateLimited(key, 3)).allowed).toBe(true)
      await checkRateLimit(key, 3, 60_000)
    }
    const blocked = await isRateLimited(key, 3)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterMs).toBeGreaterThan(0)
  })

  it('resetRateLimit clears the window', async () => {
    const key = 'login-fail:parent@example.com'
    await checkRateLimit(key, 1, 60_000)
    expect((await isRateLimited(key, 1)).allowed).toBe(false)
    await resetRateLimit(key)
    expect((await isRateLimited(key, 1)).allowed).toBe(true)
  })
})
