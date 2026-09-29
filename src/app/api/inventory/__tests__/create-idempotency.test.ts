// POST /api/inventory with an optional Idempotency-Key (#265): the fridge scan
// dialog sends one stable key per suggested row, so a create that committed
// but lost its response is replayed on retry instead of adding a second row.

jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('next/headers', () => require('@/__tests__/helpers/two-household').nextHeadersMock)
jest.mock('@/lib/session', () => require('@/__tests__/helpers/two-household').sessionMock)
jest.mock('@/lib/prisma', () => ({ prisma: require('@/__tests__/helpers/two-household').fakePrisma }))
jest.mock('@/lib/feature-gate-server', () => ({ featureGate: async () => null }))

import * as collection from '../route'
import { db, req, writesTo, type UserKey } from '@/__tests__/helpers/two-household'

const KEY = 'scan-row-0123456789abcdef'
const BODY = { name: 'Oat milk', location: 'fridge', amount: 2, unit: 'L', expires_on: null }

function create(as: UserKey, body: unknown, key?: string) {
  return collection.POST(req({ as, method: 'POST', body, headers: key ? { 'Idempotency-Key': key } : {} }))
}
const inventoryCreates = () => writesTo('inventoryItem').filter((w) => w.op === 'create')

describe('POST /api/inventory with Idempotency-Key', () => {
  beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  beforeEach(() => db.reset())

  it('creates once and replays the stored 201 for the same key and body', async () => {
    const first = await create('parentA', BODY, KEY)
    expect(first.status).toBe(201)
    expect(first.headers.get('Cache-Control')).toBe('private, no-store')
    const firstBody = await first.json()

    const again = await create('parentA', { ...BODY }, KEY)
    expect(again.status).toBe(201)
    expect(again.headers.get('Idempotency-Replayed')).toBe('true')
    expect(again.headers.get('Cache-Control')).toBe('private, no-store')
    expect((await again.json()).item.id).toBe(firstBody.item.id)
    expect(inventoryCreates()).toHaveLength(1)
    expect(db.rows('inventoryItem').filter((r: any) => r.name === 'Oat milk')).toHaveLength(1)
  })

  it('answers 422 IDEMPOTENCY_KEY_REUSED for the same key with a different body, writing nothing', async () => {
    expect((await create('parentA', BODY, KEY)).status).toBe(201)
    const res = await create('parentA', { ...BODY, name: 'Soy milk' }, KEY)
    expect(res.status).toBe(422)
    expect((await res.json()).error.code).toBe('IDEMPOTENCY_KEY_REUSED')
    expect(inventoryCreates()).toHaveLength(1)
  })

  it('rejects a malformed key with 400 and still creates without a key (older clients)', async () => {
    const bad = await create('parentA', BODY, 'short')
    expect(bad.status).toBe(400)
    expect((await bad.json()).error.code).toBe('IDEMPOTENCY_KEY_INVALID')
    expect(inventoryCreates()).toHaveLength(0)
    expect((await create('parentA', BODY)).status).toBe(201)
    expect((await create('parentA', BODY)).status).toBe(201)
    expect(inventoryCreates()).toHaveLength(2)
  })

  it('scopes keys per user: another member reusing the key creates their own row', async () => {
    expect((await create('parentA', BODY, KEY)).status).toBe(201)
    const teen = await create('teenA', BODY, KEY)
    expect(teen.status).toBe(201)
    expect(teen.headers.get('Idempotency-Replayed')).toBeNull()
    const other = await create('parentB', BODY, KEY)
    expect(other.status).toBe(201)
    expect(inventoryCreates()).toHaveLength(3)
  })

  it('does not store a failed create: the same key can be retried after a 400', async () => {
    const failed = await create('parentA', { ...BODY, ingredient_id: 'FOREIGN-or-missing' }, KEY)
    expect(failed.status).toBe(400)
    const retried = await create('parentA', { ...BODY, ingredient_id: 'FOREIGN-or-missing' }, KEY)
    expect(retried.status).toBe(400)
    expect(retried.headers.get('Idempotency-Replayed')).toBeNull()
    expect(inventoryCreates()).toHaveLength(0)
  })

  it('checks the key only after role checks: a child is still 403', async () => {
    const res = await create('childA', BODY, KEY)
    expect(res.status).toBe(403)
    expect(writesTo('idempotencyRecord')).toHaveLength(0)
  })
})
