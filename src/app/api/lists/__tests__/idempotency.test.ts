// Offline sync proof action (#162): PATCH /api/lists/items/update with an
// Idempotency-Key, on the two-household harness.

jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('next/headers', () => require('@/__tests__/helpers/two-household').nextHeadersMock)
jest.mock('@/lib/session', () => require('@/__tests__/helpers/two-household').sessionMock)
jest.mock('@/lib/prisma', () => ({ prisma: require('@/__tests__/helpers/two-household').fakePrisma }))
jest.mock('@/lib/feature-gate-server', () => ({ featureGate: async () => null }))

import { PATCH as updateItem } from '../items/update/route'
import { db, req, writesTo, expectDenied, FOREIGN, type UserKey } from '@/__tests__/helpers/two-household'
import { idempotencyRuntime } from '@/lib/idempotency'

const K1 = '11111111-1111-4111-8111-111111111111'
const K2 = '22222222-2222-4222-8222-222222222222'

function tick(as: UserKey | null, body: Record<string, unknown>, key?: string) {
  return updateItem(req({ as, method: 'PATCH', body, headers: key ? { 'Idempotency-Key': key } : {} }))
}

const item = (id: string) => db.find('listItem', id)!
const records = () => db.rows('idempotencyRecord')

describe('list item tick with Idempotency-Key', () => {
  beforeEach(() => {
    db.reset()
    idempotencyRuntime.random = () => 0.99
  })

  it('applies once and replays a duplicate with the same key', async () => {
    const first = await tick('childA', { itemId: 'item-a', checked: true }, K1)
    expect(first.status).toBe(200)
    const checkedAt = item('item-a').checked_at
    expect(item('item-a')).toMatchObject({ checked: true, checked_by: 'child-a' })

    const dup = await tick('childA', { itemId: 'item-a', checked: true }, K1)
    expect(dup.status).toBe(200)
    expect(dup.headers.get('Idempotency-Replayed')).toBe('true')
    expect(JSON.parse(JSON.stringify(await dup.json()))).toEqual(JSON.parse(JSON.stringify(await first.json())))
    expect(writesTo('listItem')).toHaveLength(1)
    expect(item('item-a').checked_at).toBe(checkedAt)
    expect(records()).toHaveLength(1)
    expect(records()[0]).toMatchObject({ scope: 'user:child-a', family_id: 'family-A', action: 'list-item.update' })
  })

  it('refuses the same key for a different request (422) and changes nothing', async () => {
    await tick('parentA', { itemId: 'item-a', checked: true }, K1)
    const reused = await tick('parentA', { itemId: 'item-a', checked: false }, K1)
    expect(reused.status).toBe(422)
    expect((await reused.json()).error.code).toBe('IDEMPOTENCY_KEY_REUSED')
    expect(item('item-a').checked).toBe(true)
    expect(writesTo('listItem')).toHaveLength(1)
  })

  it('rejects a malformed key before any write', async () => {
    const res = await tick('parentA', { itemId: 'item-a', checked: true }, 'bad key')
    expect(res.status).toBe(400)
    expect(db.writes).toHaveLength(0)
  })

  it('a signed-out caller cannot replay: 401 and no record is read or written', async () => {
    await tick('parentA', { itemId: 'item-a', checked: true }, K1)
    const before = db.writes.length
    const res = await tick(null, { itemId: 'item-a', checked: true }, K1)
    expect(res.status).toBe(401)
    expect(res.headers.get('Idempotency-Replayed')).toBeNull()
    expect(db.writes).toHaveLength(before)
  })

  it("another household cannot tick family A's item with a key, and leaves no record", async () => {
    await expectDenied(await tick('childB', { itemId: 'item-a', checked: true }, K1))
    expect(writesTo('listItem')).toHaveLength(0)
    expect(records()).toHaveLength(0)
    expect(item('item-a').checked).toBe(false)
  })

  it("the same key in two households never replays the other household's response", async () => {
    await tick('parentA', { itemId: 'item-a', checked: true }, K1)
    const resB = await tick('parentB', { itemId: 'item-b', checked: true }, K1)
    expect(resB.status).toBe(200)
    expect(resB.headers.get('Idempotency-Replayed')).toBeNull()
    const body = await resB.json()
    expect(body.item.id).toBe('item-b')
    expect(item('item-b').checked).toBe(true)
    // And A's replay still carries A's item only.
    const resA = await tick('parentA', { itemId: 'item-a', checked: true }, K1)
    expect(JSON.stringify(await resA.json())).not.toContain(FOREIGN)
  })

  it('explicit state: setting the current state again is a no-op that keeps attribution', async () => {
    await tick('childA', { itemId: 'item-a', checked: true }, K1)
    const res = await tick('teenA', { itemId: 'item-a', checked: true }, K2)
    expect(res.status).toBe(200)
    expect(writesTo('listItem')).toHaveLength(1)
    expect(item('item-a').checked_by).toBe('child-a')
  })

  it('two devices: the last write the server receives wins', async () => {
    await tick('childA', { itemId: 'item-a', checked: true }, K1)
    await tick('parentA', { itemId: 'item-a', checked: false }, K2)
    expect(item('item-a')).toMatchObject({ checked: false, checked_by: null, checked_at: null })
    // A late replay of the first device's key does not re-apply it.
    const late = await tick('childA', { itemId: 'item-a', checked: true }, K1)
    expect(late.headers.get('Idempotency-Replayed')).toBe('true')
    expect(item('item-a').checked).toBe(false)
  })

  it('an item that no longer exists is 404 and the key is released', async () => {
    const res = await tick('parentA', { itemId: 'item-gone', checked: true }, K1)
    expect(res.status).toBe(404)
    expect(records()).toHaveLength(0)
  })

  it('requests without the header behave as before', async () => {
    const res = await tick('parentA', { itemId: 'item-a', checked: true })
    expect(res.status).toBe(200)
    expect(records()).toHaveLength(0)
  })
})
