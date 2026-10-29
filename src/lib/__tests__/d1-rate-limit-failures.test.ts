const mockGetD1Database = jest.fn()
jest.mock('@/lib/cloudflare/database', () => ({ getD1Database: (...args: unknown[]) => mockGetD1Database(...args) }))
jest.mock('@/lib/prisma', () => ({ prisma: undefined }))
import { checkRateLimit, isRateLimited, resetRateLimit } from '@/lib/rate-limit-db'

const original = process.env.HEREWOVEN_STORAGE
beforeEach(() => { process.env.HEREWOVEN_STORAGE = 'd1'; mockGetD1Database.mockReset() })
afterAll(() => {
  if (original === undefined) delete process.env.HEREWOVEN_STORAGE
  else process.env.HEREWOVEN_STORAGE = original
})

it('refuses attempts and read-only checks while D1 is unavailable, without an in-memory allowance', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
  mockGetD1Database.mockRejectedValue(new Error('binding unavailable'))
  try {
    expect(await checkRateLimit('fabricated-key', 3, 1000)).toEqual({ allowed: false, retryAfterMs: 1000, remaining: 0 })
    expect(await isRateLimited('fabricated-key', 3)).toEqual({ allowed: false, retryAfterMs: 60_000, remaining: 0 })
  } finally { warn.mockRestore() }
})

it('treats a failed success-reset as best effort without selecting PostgreSQL', async () => {
  mockGetD1Database.mockRejectedValue(new Error('binding unavailable'))
  await expect(resetRateLimit('fabricated-key')).resolves.toBeUndefined()
})
