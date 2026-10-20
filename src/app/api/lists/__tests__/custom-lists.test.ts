jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('next/headers', () => require('@/__tests__/helpers/two-household').nextHeadersMock)
jest.mock('@/lib/session', () => require('@/__tests__/helpers/two-household').sessionMock)
jest.mock('@/lib/prisma', () => ({ prisma: require('@/__tests__/helpers/two-household').fakePrisma }))
jest.mock('@/lib/feature-gate-server', () => ({ featureGate: jest.fn(async () => null) }))

jest.mock('@/lib/household-lock', () => {
  const actual = jest.requireActual('@/lib/household-lock')
  return { ...actual, lockUser: jest.fn(actual.lockUser), lockHouseholdForJoin: jest.fn(actual.lockHouseholdForJoin) }
})

import { lockUser, lockHouseholdForJoin } from '@/lib/household-lock'
import { POST } from '../create/route'
import { db, req, writesTo } from '@/__tests__/helpers/two-household'
import { createListSchema } from '@/lib/validations'
import { isGroceryListType } from '@/lib/grocery-display'

beforeEach(() => { db.reset(); jest.clearAllMocks() })

it('creates a Custom list only in the authenticated household', async () => {
  const response = await POST(req({ as: 'parentA', method: 'POST', body: { name: '  Camping  ', type: 'custom', description: 'Our packing', family_id: 'family-B' } }))
  expect(response.status).toBe(200)
  expect((await response.json()).list).toMatchObject({ name: 'Camping', type: 'custom', family_id: 'family-A', created_by: 'parent-a', description: 'Our packing' })
})

it.each(['childA', null] as const)('refuses custom creation by %s', async as => {
  const response = await POST(req({ as, method: 'POST', body: { name: 'Camping', type: 'custom' } }))
  expect(response.status).toBe(as ? 403 : 401)
  expect(writesTo('list').filter(w => w.op === 'create')).toHaveLength(0)
})

it('keeps custom as a plain checklist and validates names', () => {
  expect(isGroceryListType('custom')).toBe(false)
  expect(createListSchema.safeParse({ name: ' ', type: 'custom' }).success).toBe(false)
  expect(createListSchema.safeParse({ name: 'Trip', type: 'unrecognized' }).success).toBe(false)
})

const cover = '/api/files/chores/abcdef0123456789.jpg'
it('attaches an owned list image under the household transaction', async () => {
  db.rows('upload').push({id:'up',filename:'abcdef0123456789.jpg',family_id:'family-A'})
  const response = await POST(req({as:'parentA',method:'POST',body:{name:'Trip',type:'custom',image_url:cover}}))
  expect(response.status).toBe(200)
  expect((await response.json()).list).toMatchObject({family_id:'family-A',image_url:cover})
})
it.each(['https://example.com/picture.jpg',cover])('refuses external or foreign image %s without writing a list', async image_url => {
  db.rows('upload').push({id:'foreign',filename:'abcdef0123456789.jpg',family_id:'family-B'})
  const response = await POST(req({as:'parentA',method:'POST',body:{name:'Trip',type:'custom',image_url}}))
  expect(response.status).toBe(400)
  expect(writesTo('list').filter(w=>w.op==='create')).toHaveLength(0)
})

it.each([false, true])('renews membership, role and session under locks (cover: %s)', async withCover => {
  const image_url = withCover ? cover : undefined
  db.rows('upload').push({ id: 'owned', filename: 'abcdef0123456789.jpg', family_id: 'family-A' })
  const response = await POST(req({ as: 'teenA', method: 'POST', body: { name: 'Teen list', type: 'custom', image_url } }))
  expect(response.status).toBe(200)
  const first = jest.mocked(lockUser).mock.invocationCallOrder[0]
  expect(first).toBeLessThan(jest.mocked(lockHouseholdForJoin).mock.invocationCallOrder[0])
})
it.each([
  [false, 'revoked', 401], [true, 'revoked', 401],
  [false, 'removed', 403], [true, 'removed', 403],
  [false, 'child', 403], [true, 'child', 403],
] as const)('refuses stale create after waiting (cover %s, %s)', async (withCover, change, status) => {
  db.rows('upload').push({ id: 'owned', filename: 'abcdef0123456789.jpg', family_id: 'family-A' })
  const real = jest.requireActual('@/lib/household-lock').lockHouseholdForJoin
  jest.mocked(lockHouseholdForJoin).mockImplementationOnce(async (tx, familyId) => {
    const exists = await real(tx, familyId)
    const user = db.find('user', 'parent-a')!
    if (change === 'revoked') user.token_version += 1
    if (change === 'removed') user.family_id = null
    if (change === 'child') user.role = 'child'
    return exists
  })
  const response = await POST(req({ as: 'parentA', method: 'POST', body: { name: 'Refused stale create', type: 'custom', ...(withCover ? { image_url: cover } : {}) } }))
  expect(response.status).toBe(status)
  expect(writesTo('list').filter(write => write.op === 'create')).toHaveLength(0)
})
