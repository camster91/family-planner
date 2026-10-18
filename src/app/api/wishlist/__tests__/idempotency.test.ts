// Retry-safe Wishlist mutations retain the existing family and role contract.
jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('next/headers', () => require('@/__tests__/helpers/two-household').nextHeadersMock)
jest.mock('@/lib/session', () => require('@/__tests__/helpers/two-household').sessionMock)
jest.mock('@/lib/prisma', () => ({ prisma: require('@/__tests__/helpers/two-household').fakePrisma }))
jest.mock('@/lib/feature-gate-server', () => ({ featureGate: async () => null }))

import * as wishlist from '../route'
import * as item from '../[id]/route'
import { PATCH as setStatus } from '../[id]/status/route'
import {
  bodyOf,
  db,
  FAMILY_A,
  params,
  req,
  USER_IDS,
  writesTo,
} from '@/__tests__/helpers/two-household'

const CREATE_KEY = '00000000-0000-4000-8000-000000000001'
const UPDATE_KEY = '00000000-0000-4000-8000-000000000002'
const DELETE_KEY = '00000000-0000-4000-8000-000000000003'
const STATUS_KEY = '00000000-0000-4000-8000-000000000004'

const key = (value: string) => ({ 'Idempotency-Key': value })

beforeEach(() => {
  db.reset()
  // The shared isolation fixture is intentionally legacy (features: null).
  // Keyed tests use an explicit enabled family so the locked helper exercises
  // the same effective-feature policy as production.
  db.find('family', FAMILY_A)!.features = { wishlist: true }
})

describe('Wishlist mutation receipts', () => {
  it('replays a keyed create and rejects a changed body without another row', async () => {
    const body = { title: '  Red bike  ', description: 'For school' }
    const first = await wishlist.POST(req({ as: 'childA', body, headers: key(CREATE_KEY) }))
    const second = await wishlist.POST(req({ as: 'childA', body, headers: key(CREATE_KEY) }))

    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expect(second.headers.get('Idempotency-Replayed')).toBe('true')
    expect(await bodyOf(second)).toEqual(await bodyOf(first))
    expect(db.rows('wishlistItem').filter((row) => row.family_id === FAMILY_A)).toHaveLength(2)
    expect(writesTo('wishlistItem').filter((write) => write.op === 'create')).toHaveLength(1)

    const changed = await wishlist.POST(
      req({ as: 'childA', body: { ...body, title: 'Blue bike' }, headers: key(CREATE_KEY) }),
    )
    expect(changed.status).toBe(422)
    expect((await bodyOf(changed)).error).toMatchObject({
      code: 'IDEMPOTENCY_KEY_REUSED',
      retryable: false,
    })
    expect(writesTo('wishlistItem').filter((write) => write.op === 'create')).toHaveLength(1)
  })

  it('replays an edit once, then rechecks current ownership after a role change', async () => {
    const body = { title: 'Parent edit' }
    const first = await item.PATCH(
      req({ as: 'parentA', body, headers: key(UPDATE_KEY) }),
      params({ id: 'wish-a' }),
    )
    const second = await item.PATCH(
      req({ as: 'parentA', body, headers: key(UPDATE_KEY) }),
      params({ id: 'wish-a' }),
    )

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(second.headers.get('Idempotency-Replayed')).toBe('true')
    expect(await bodyOf(second)).toEqual(await bodyOf(first))
    expect(writesTo('wishlistItem').filter((write) => write.op === 'update')).toHaveLength(1)

    db.find('user', USER_IDS.parentA)!.role = 'child'
    const refused = await item.PATCH(
      req({ as: 'parentA', body, headers: key(UPDATE_KEY) }),
      params({ id: 'wish-a' }),
    )
    expect(refused.status).toBe(403)
    db.find('user', USER_IDS.parentA)!.role = 'parent'
  })

  it('replays a keyed delete after the row is gone without resurrecting it', async () => {
    const first = await item.DELETE(
      req({ as: 'childA', headers: key(DELETE_KEY) }),
      params({ id: 'wish-a' }),
    )
    const second = await item.DELETE(
      req({ as: 'childA', headers: key(DELETE_KEY) }),
      params({ id: 'wish-a' }),
    )

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(second.headers.get('Idempotency-Replayed')).toBe('true')
    expect(await bodyOf(second)).toEqual({ success: true })
    expect(db.find('wishlistItem', 'wish-a')).toBeUndefined()
    expect(writesTo('wishlistItem').filter((write) => write.op === 'delete')).toHaveLength(1)
  })

  it('replays status after deletion and keeps the parent-only guard', async () => {
    const first = await setStatus(
      req({ as: 'parentA', body: { status: 'received' }, headers: key(STATUS_KEY) }),
      params({ id: 'wish-a' }),
    )
    db.tables.wishlistItem = db.rows('wishlistItem').filter((row) => row.id !== 'wish-a')
    const second = await setStatus(
      req({ as: 'parentA', body: { status: 'received' }, headers: key(STATUS_KEY) }),
      params({ id: 'wish-a' }),
    )

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(second.headers.get('Idempotency-Replayed')).toBe('true')
    expect(writesTo('wishlistItem').filter((write) => write.op === 'update')).toHaveLength(1)

    const child = await setStatus(
      req({ as: 'childA', body: { status: 'received' }, headers: { 'Idempotency-Key': '00000000-0000-4000-8000-000000000005' } }),
      params({ id: 'wish-b' }),
    )
    expect(child.status).toBe(403)
  })

  it('refuses a completed replay after the Wishlist feature is turned off', async () => {
    const first = await wishlist.POST(
      req({ as: 'childA', body: { title: 'Feature switch' }, headers: key('00000000-0000-4000-8000-000000000006') }),
    )
    expect(first.status).toBe(201)
    db.find('family', FAMILY_A)!.features = { wishlist: false }

    const replay = await wishlist.POST(
      req({ as: 'childA', body: { title: 'Feature switch' }, headers: key('00000000-0000-4000-8000-000000000006') }),
    )
    expect(replay.status).toBe(403)
    expect(replay.headers.get('Idempotency-Replayed')).toBeNull()
  })
})
