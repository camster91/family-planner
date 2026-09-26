// Session-generation (revocation) contract.
//
// A JWT stays cryptographically valid for its full 7 days, so signature and
// expiry alone cannot express "this session was revoked". `User.token_version`
// is the generation counter, bumped on password reset and password change.
//
// These tests pin the shared check that every authentication path now routes
// through. Previously only `authenticateRequest` consulted it, so a revoked
// cookie still authenticated `getServerUser()` (and therefore every route and
// page reading the session that way) and still walked through the /dashboard
// gate in middleware.

let mockPrisma: { user: { findUnique: jest.Mock } } | undefined

jest.mock('@/lib/prisma', () => ({
  get prisma() {
    return mockPrisma
  },
}))

import { signToken } from '@/lib/auth'
import { getTokenVersion, isSessionCurrent, resolveSession, verifySessionToken } from '@/lib/session'

const USER_ID = 'user-1'
const SECRET = 'a'.repeat(32)

function tokenFor(tv?: number): string {
  return signToken({ userId: USER_ID, email: 'cam@example.com', tv })
}

beforeAll(() => {
  process.env.JWT_SECRET = SECRET
})

beforeEach(() => {
  mockPrisma = { user: { findUnique: jest.fn() } }
})

describe('getTokenVersion', () => {
  it('returns the stored generation', async () => {
    mockPrisma!.user.findUnique.mockResolvedValue({ token_version: 4 })
    expect(await getTokenVersion(USER_ID)).toBe(4)
  })

  it('returns null for a deleted account, so it is distinguishable from generation 0', async () => {
    mockPrisma!.user.findUnique.mockResolvedValue(null)
    expect(await getTokenVersion(USER_ID)).toBeNull()
  })

  it('returns null when the prisma client is unavailable', async () => {
    mockPrisma = undefined
    expect(await getTokenVersion(USER_ID)).toBeNull()
  })
})

describe('isSessionCurrent', () => {
  it('accepts a token whose tv matches the stored generation', async () => {
    mockPrisma!.user.findUnique.mockResolvedValue({ token_version: 2 })
    expect(await isSessionCurrent({ userId: USER_ID, email: 'e', tv: 2 })).toBe(true)
  })

  it('rejects a token issued before the last revocation', async () => {
    mockPrisma!.user.findUnique.mockResolvedValue({ token_version: 3 })
    expect(await isSessionCurrent({ userId: USER_ID, email: 'e', tv: 2 })).toBe(false)
  })

  it('treats a token with no tv claim as generation 0', async () => {
    mockPrisma!.user.findUnique.mockResolvedValue({ token_version: 0 })
    expect(await isSessionCurrent({ userId: USER_ID, email: 'e' })).toBe(true)
  })

  it('rejects every token once the user is deleted', async () => {
    mockPrisma!.user.findUnique.mockResolvedValue(null)
    expect(await isSessionCurrent({ userId: USER_ID, email: 'e', tv: 0 })).toBe(false)
  })

  it('rejects when the prisma client is unavailable, rather than assuming valid', async () => {
    mockPrisma = undefined
    expect(await isSessionCurrent({ userId: USER_ID, email: 'e', tv: 0 })).toBe(false)
  })
})

describe('verifySessionToken', () => {
  it('returns the payload for a live session', async () => {
    mockPrisma!.user.findUnique.mockResolvedValue({ token_version: 1 })
    const payload = await verifySessionToken(tokenFor(1))
    expect(payload).not.toBeNull()
    expect(payload!.userId).toBe(USER_ID)
  })

  it('returns null for a revoked session even though the JWT still verifies', async () => {
    // The regression this whole module exists for: the token is genuine and
    // unexpired, but a password reset has moved the generation on.
    mockPrisma!.user.findUnique.mockResolvedValue({ token_version: 9 })
    const stale = tokenFor(1)
    expect(await verifySessionToken(stale)).toBeNull()
  })

  it('returns null for a tampered token, without touching the database', async () => {
    expect(await verifySessionToken(tokenFor(1) + 'x')).toBeNull()
    expect(mockPrisma!.user.findUnique).not.toHaveBeenCalled()
  })
})

// D6 (#102): role and family_id are resolved from the database on every
// request, in the same lookup as the generation check. The claims baked into
// the JWT at sign-in are never authoritative.
describe('resolveSession / verifySessionToken — current role and family (D6)', () => {
  function tokenWithClaims(role: string, family_id: string | null, tv = 0): string {
    return signToken({ userId: USER_ID, email: 'cam@example.com', role, family_id, tv })
  }

  it('reads role and family_id in the same single query as token_version', async () => {
    mockPrisma!.user.findUnique.mockResolvedValue({ token_version: 0, role: 'parent', family_id: 'fam-1' })
    await verifySessionToken(tokenWithClaims('parent', 'fam-1'))
    expect(mockPrisma!.user.findUnique).toHaveBeenCalledTimes(1)
    expect(mockPrisma!.user.findUnique).toHaveBeenCalledWith({
      where: { id: USER_ID },
      select: { token_version: true, role: true, family_id: true },
    })
  })

  it('a demoted member (JWT says parent, DB says child) is a child on the next request', async () => {
    mockPrisma!.user.findUnique.mockResolvedValue({ token_version: 0, role: 'child', family_id: 'fam-1' })
    const payload = await verifySessionToken(tokenWithClaims('parent', 'fam-1'))
    expect(payload).toMatchObject({ userId: USER_ID, role: 'child', family_id: 'fam-1' })
  })

  it('a member moved out of a household loses the old family_id immediately', async () => {
    mockPrisma!.user.findUnique.mockResolvedValue({ token_version: 0, role: 'parent', family_id: null })
    const payload = await verifySessionToken(tokenWithClaims('parent', 'fam-old'))
    expect(payload!.family_id).toBeNull()
  })

  it('a member moved to another household gets the new family_id, not the JWT one', async () => {
    mockPrisma!.user.findUnique.mockResolvedValue({ token_version: 0, role: 'teen', family_id: 'fam-new' })
    const payload = await verifySessionToken(tokenWithClaims('parent', 'fam-old'))
    expect(payload).toMatchObject({ role: 'teen', family_id: 'fam-new' })
  })

  it('a legacy token with no role claim still gets the DB role', async () => {
    mockPrisma!.user.findUnique.mockResolvedValue({ token_version: 0, role: 'child', family_id: 'fam-1' })
    const payload = await resolveSession({ userId: USER_ID, email: 'e' })
    expect(payload!.role).toBe('child')
  })

  it('still rejects a revoked generation and a deleted account', async () => {
    mockPrisma!.user.findUnique.mockResolvedValue({ token_version: 5, role: 'parent', family_id: 'fam-1' })
    expect(await verifySessionToken(tokenWithClaims('parent', 'fam-1', 4))).toBeNull()
    mockPrisma!.user.findUnique.mockResolvedValue(null)
    expect(await resolveSession({ userId: USER_ID, email: 'e', tv: 0 })).toBeNull()
  })
})
