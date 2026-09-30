// Account and household deletion routes (D-3, docs/product/ACCOUNT_DELETION.md):
// DELETE /api/users (own account), DELETE /api/family (whole household) and
// GET /api/users/deletion, against the two-household fake database. Fresh
// authorization, roles, last-parent rule, paired-device refusal, the other
// household untouched, idempotent retries and the cleared session cookie.

jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('next/headers', () => require('@/__tests__/helpers/two-household').nextHeadersMock)
jest.mock('@/lib/session', () => require('@/__tests__/helpers/two-household').sessionMock)
jest.mock('@/lib/prisma', () => ({ prisma: require('@/__tests__/helpers/two-household').fakePrisma }))
jest.mock('@/lib/rate-limit-db', () => {
  const mock = require('@/__tests__/helpers/two-household').rateLimitMock
  return { ...mock, checkRateLimit: jest.fn(mock.checkRateLimit) }
})
jest.mock('@/lib/calendar-sync/sync', () => ({
  ...jest.requireActual('@/lib/calendar-sync/sync'),
  revokeProviderGrant: jest.fn(async () => false),
}))

import { DELETE as deleteAccount } from '../route'
import { GET as deletionOptions } from '../deletion/route'
import { DELETE as deleteFamily } from '@/app/api/family/route'
import { db, req, FAMILY_A, FAMILY_B } from '@/__tests__/helpers/two-household'
import {
  seedDevices,
  deviceReq,
  enableSharedDevice,
  disableSharedDevice,
  setNow,
  resetClock,
  setPassword,
  errorCode,
} from '@/__tests__/helpers/device'
import * as rateLimit from '@/lib/rate-limit-db'
import type { UserKey } from '@/__tests__/helpers/two-household'

const PW = 'correct horse 42'
const KEY = '5f0c2b3e-8a41-4c1d-9e0f-1a2b3c4d5e6f'

function account(as: UserKey | null, body: unknown, headers: Record<string, string> = {}) {
  return deleteAccount(req({ as, method: 'DELETE', path: '/api/users', body, headers }))
}
function household(as: UserKey | null, body: unknown, headers: Record<string, string> = {}) {
  return deleteFamily(req({ as, method: 'DELETE', path: '/api/family', body, headers }))
}
const goodHousehold = { familyId: FAMILY_A, password: PW, confirmation: 'household a' }

function clearedSession(res: any): boolean {
  return (res.setCookies ?? []).some((c: any) => c.name === 'session_token' && c.value === '' && c.options.maxAge === 0)
}

function addSecondParent() {
  db.rows('user').push({
    id: 'parent-a2',
    email: 'parent-a2@example.test',
    name: 'Second Parent A',
    role: 'parent',
    family_id: FAMILY_A,
    created_at: new Date('2026-09-02T00:00:00Z'),
    password: 'hash',
    token_version: 0,
  })
}

beforeAll(() => {
  for (const level of ['log', 'warn', 'error', 'info'] as const) jest.spyOn(console, level).mockImplementation(() => undefined)
})

beforeEach(() => {
  db.reset()
  for (const who of ['parentA', 'teenA', 'childA', 'parentB', 'loner'] as UserKey[]) setPassword(who, PW)
})

describe('DELETE /api/users (own account)', () => {
  it('401 without a session; nothing written', async () => {
    expect((await account(null, { password: PW, confirmation: 'DELETE' })).status).toBe(401)
    expect(db.writes).toHaveLength(0)
  })

  it('requires the current password and the typed word', async () => {
    const missing = await account('teenA', { confirmation: 'DELETE' })
    expect([missing.status, (await missing.json()).code]).toEqual([400, 'PASSWORD_REQUIRED'])
    const typo = await account('teenA', { password: PW, confirmation: 'DELET' })
    expect([typo.status, (await typo.json()).code]).toEqual([400, 'CONFIRMATION_MISMATCH'])
    const wrong = await account('teenA', { password: 'nope', confirmation: 'DELETE' })
    expect([wrong.status, (await wrong.json()).code]).toEqual([400, 'INVALID_PASSWORD'])
    const noBody = await account('teenA', undefined)
    expect(noBody.status).toBe(400)
    expect(db.writes).toHaveLength(0)
    expect(db.find('user', 'teen-a')).toBeDefined()
  })

  it('is rate limited per member', async () => {
    const spy = rateLimit.checkRateLimit as jest.Mock
    spy.mockResolvedValueOnce({ allowed: false, remaining: 0, retryAfterMs: 60_000 })
    const res = await account('teenA', { password: PW, confirmation: 'delete' })
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('60')
    expect(spy).toHaveBeenCalledWith('account-delete:teen-a', expect.any(Number), expect.any(Number))
    expect(db.find('user', 'teen-a')).toBeDefined()
  })

  it.each<[UserKey, string]>([
    ['teenA', 'teen-a'],
    ['childA', 'child-a'],
  ])('%s may delete their own account; the household and B stay; the cookie is cleared', async (who, id) => {
    const res = await account(who, { password: PW, confirmation: ' delete ' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true, mode: 'account' })
    expect(clearedSession(res)).toBe(true)
    expect(db.find('user', id)).toBeUndefined()
    expect(db.find('family', FAMILY_A)).toBeDefined()
    expect(db.find('user', 'parent-a')).toBeDefined()
    expect(db.find('family', FAMILY_B)).toBeDefined()
    expect(db.rows('user').filter((u) => u.family_id === FAMILY_B)).toHaveLength(2)
  })

  it('the only parent gets 409 LAST_PARENT', async () => {
    const res = await account('parentA', { password: PW, confirmation: 'DELETE' })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'LAST_PARENT' })
    expect(clearedSession(res)).toBe(false)
    expect(db.find('user', 'parent-a')).toBeDefined()
  })

  it('a parent with another parent may delete their own account', async () => {
    addSecondParent()
    const res = await account('parentA', { password: PW, confirmation: 'DELETE' })
    expect(res.status).toBe(200)
    expect(db.find('user', 'parent-a')).toBeUndefined()
    expect(db.find('chore', 'chore-a')).toMatchObject({ created_by: 'parent-a2' })
  })

  it('an invalid Idempotency-Key is a 400 before anything runs', async () => {
    const res = await account('teenA', { password: PW, confirmation: 'DELETE' }, { 'Idempotency-Key': 'short' })
    expect(res.status).toBe(400)
    expect(db.find('user', 'teen-a')).toBeDefined()
  })

  it('a duplicate while the first is running is 409; after it finished a retry is 401', async () => {
    // The first request holds the in-progress record.
    const { hashIdempotentRequest } = require('@/lib/idempotency')
    db.rows('idempotencyRecord').push({
      id: 'idem-running',
      scope: 'user:teen-a',
      key: KEY,
      family_id: FAMILY_A,
      user_id: 'teen-a',
      action: 'account.delete',
      request_hash: hashIdempotentRequest('account.delete', { mode: 'account' }),
      response_status: null,
      response_body: null,
      created_at: new Date(),
      expires_at: new Date(Date.now() + 60_000),
    })
    const dup = await account('teenA', { password: PW, confirmation: 'DELETE' }, { 'Idempotency-Key': KEY })
    expect(dup.status).toBe(409)
    expect(db.find('user', 'teen-a')).toBeDefined()

    db.tables.idempotencyRecord = []
    const first = await account('teenA', { password: PW, confirmation: 'DELETE' }, { 'Idempotency-Key': KEY })
    expect(first.status).toBe(200)
    // The member's records went with the account.
    expect(db.rows('idempotencyRecord').filter((r) => r.user_id === 'teen-a')).toHaveLength(0)
    const retry = await account('teenA', { password: PW, confirmation: 'DELETE' }, { 'Idempotency-Key': KEY })
    expect(retry.status).toBe(401)
    expect(db.find('user', 'parent-a')).toBeDefined()
  })
})

describe('DELETE /api/family (whole household)', () => {
  it('401 without a session', async () => {
    expect((await household(null, goodHousehold)).status).toBe(401)
    expect(db.writes).toHaveLength(0)
  })

  it.each<[UserKey]>([['teenA'], ['childA']])('%s gets 403, even with a valid password and name', async (who) => {
    expect((await household(who, goodHousehold)).status).toBe(403)
    expect(db.find('family', FAMILY_A)).toBeDefined()
    expect(db.writes).toHaveLength(0)
  })

  it("another household's parent gets 403 and household A is untouched", async () => {
    const res = await household('parentB', goodHousehold)
    expect(res.status).toBe(403)
    expect(JSON.stringify(await res.json())).not.toContain('Household A')
    expect(db.find('family', FAMILY_A)).toBeDefined()
    expect(db.writes).toHaveLength(0)
  })

  it('requires the password and the household name typed out', async () => {
    const wrongName = await household('parentA', { ...goodHousehold, confirmation: 'DELETE' })
    expect([wrongName.status, (await wrongName.json()).code]).toEqual([400, 'CONFIRMATION_MISMATCH'])
    const wrongPw = await household('parentA', { ...goodHousehold, password: 'nope' })
    expect([wrongPw.status, (await wrongPw.json()).code]).toEqual([400, 'INVALID_PASSWORD'])
    const noPw = await household('parentA', { familyId: FAMILY_A, confirmation: 'Household A' })
    expect([noPw.status, (await noPw.json()).code]).toEqual([400, 'PASSWORD_REQUIRED'])
    expect(db.find('family', FAMILY_A)).toBeDefined()
    expect(db.writes).toHaveLength(0)
  })

  it('409 OTHER_PARENTS_EXIST while another parent is in the household', async () => {
    addSecondParent()
    const res = await household('parentA', goodHousehold)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'OTHER_PARENTS_EXIST' })
    expect(db.find('family', FAMILY_A)).toBeDefined()
  })

  it('the only parent deletes household A and every member; B stays; the cookie is cleared; a retry is 401', async () => {
    const res = await household('parentA', goodHousehold, { 'Idempotency-Key': KEY })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true, mode: 'household', membersRemoved: 3 })
    expect(clearedSession(res)).toBe(true)
    expect(db.find('family', FAMILY_A)).toBeUndefined()
    for (const id of ['parent-a', 'teen-a', 'child-a']) expect(db.find('user', id)).toBeUndefined()
    expect(db.rows('chore').map((c) => c.family_id)).toEqual([FAMILY_B])
    expect(db.rows('familyInvite').map((i) => i.family_id)).toEqual([FAMILY_B])
    expect(db.find('family', FAMILY_B)).toMatchObject({ feed_token: 'feed-token-b' })
    expect(db.find('user', 'parent-b')).toBeDefined()

    const retry = await household('parentA', goodHousehold, { 'Idempotency-Key': KEY })
    expect(retry.status).toBe(401)
    expect(db.find('family', FAMILY_B)).toBeDefined()
  })
})

describe('paired shared device', () => {
  beforeEach(() => {
    enableSharedDevice()
    setNow(new Date())
  })
  afterAll(() => {
    disableSharedDevice()
    resetClock()
  })

  it('a device cookie gets 403 DEVICE_WRITE_NOT_ALLOWED from both routes, before person auth', async () => {
    const fx = seedDevices()
    for (const [handler, body] of [
      [deleteAccount, { password: PW, confirmation: 'DELETE' }],
      [deleteFamily, goodHousehold],
    ] as const) {
      const res = await handler(deviceReq({ method: 'DELETE', cookies: fx.d1.cookies, body }))
      expect(res.status).toBe(403)
      expect(await errorCode(res)).toBe('DEVICE_WRITE_NOT_ALLOWED')
      // Even with a parent session cookie next to the device credential.
      const both = await handler(deviceReq({ method: 'DELETE', as: 'parentA', cookies: fx.d1.cookies, body }))
      expect(both.status).toBe(403)
    }
    expect(db.find('family', FAMILY_A)).toBeDefined()
    expect(db.find('user', 'parent-a')).toBeDefined()
  })

  it('the deletion-options read is refused too, even next to a parent session', async () => {
    const fx = seedDevices()
    for (const as of [undefined, 'parentA'] as const) {
      const res = await deletionOptions(deviceReq({ method: 'GET', as, cookies: fx.d1.cookies }))
      expect(res.status).toBe(403)
      expect(await errorCode(res)).toBe('DEVICE_WRITE_NOT_ALLOWED')
    }
  })
})

describe('GET /api/users/deletion', () => {
  it('401 without a session', async () => {
    expect((await deletionOptions(req())).status).toBe(401)
  })

  it('describes only the caller and their own household', async () => {
    const parent = await (await deletionOptions(req({ as: 'parentA' }))).json()
    expect(parent).toEqual({
      role: 'parent',
      household: { id: FAMILY_A, name: 'Household A', memberCount: 3, parentCount: 1 },
      isOnlyParent: true,
      canDeleteAccount: false,
      canDeleteHousehold: true,
    })
    const child = await (await deletionOptions(req({ as: 'childA' }))).json()
    expect(child).toMatchObject({ canDeleteAccount: true, canDeleteHousehold: false })
    const b = await (await deletionOptions(req({ as: 'parentB' }))).json()
    expect(JSON.stringify(b)).not.toContain('Household A')
    expect(db.writes).toHaveLength(0)
  })
})
