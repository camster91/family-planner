jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('next/headers', () => require('@/__tests__/helpers/two-household').nextHeadersMock)
jest.mock('@/lib/session', () => require('@/__tests__/helpers/two-household').sessionMock)
jest.mock('@/lib/prisma', () => ({ prisma: require('@/__tests__/helpers/two-household').fakePrisma }))
jest.mock('@/lib/feature-gate-server', () => ({ featureGate: jest.fn(async () => null) }))

import { POST } from '../items/create/route'
import { db, req, writesTo, fakePrisma, type UserKey } from '@/__tests__/helpers/two-household'
import { idempotencyRuntime } from '@/lib/idempotency'
import { featureGate } from '@/lib/feature-gate-server'

const KEY = 'person-add-0123456789abcdef'
const body = { listId: 'list-a', content: 'Oat milk', quantity: 1 }
const add = (as: UserKey | null, data: unknown = body, key: string | undefined = KEY) =>
  POST(req({ as, method: 'POST', body: data, headers: key ? { 'Idempotency-Key': key } : {} }))
const creates = () => writesTo('listItem').filter((x) => x.op === 'create')

describe('person list create idempotency and isolation', () => {
  beforeEach(() => { db.reset(); idempotencyRuntime.random = () => 0.99; jest.mocked(featureGate).mockResolvedValue(null) })

  it('stores the item and response together and replays the same key', async () => {
    const first = await add('parentA'); const original = await first.json()
    expect(first.status).toBe(200)
    expect(original.item).toMatchObject({ content: 'Oat milk', added_by: 'parent-a' })
    const again = await add('parentA')
    expect(again.headers.get('Idempotency-Replayed')).toBe('true')
    expect(await again.json()).toEqual(original)
    expect(creates()).toHaveLength(1)
    expect(db.rows('idempotencyRecord')[0]).toMatchObject({ action: 'list-item.add', response_status: 200 })
  })

  it('rejects changed text or list with the same key', async () => {
    await add('parentA')
    const changed = await add('parentA', { ...body, content: 'Rice' })
    expect(changed.status).toBe(422); expect((await changed.json()).error.code).toBe('IDEMPOTENCY_KEY_REUSED')
    expect(creates()).toHaveLength(1)
  })

  it('keeps deliberate same-text adds separate with different keys', async () => {
    await add('teenA'); await add('teenA', body, KEY + '-second')
    expect(creates()).toHaveLength(2)
  })

  it('hashes the validated default quantity and trimmed text consistently', async () => {
    await add('parentA')
    const replay = await add('parentA', { listId: 'list-a', content: '  Oat milk  ' })
    expect(replay.headers.get('Idempotency-Replayed')).toBe('true')
    expect(creates()).toHaveLength(1)
  })

  it('a missing list cannot create or reach a stored response', async () => {
    await add('parentA')
    await fakePrisma.list.delete({ where: { id: 'list-a' } })
    expect((await add('parentA')).status).toBe(404)
    expect(creates()).toHaveLength(1)
  })

  it('preserves the no-key legacy response and generic-list fields', async () => {
    const data = { ...body, quantity: 3, notes: 'A household note', category: 'custom' }
    const legacy = () => POST(req({ as: 'parentA', method: 'POST', body: data }))
    const first = await legacy(); await legacy()
    expect(first.status).toBe(200)
    expect((await first.json()).item).toMatchObject({ quantity: 3, notes: data.notes, category: 'custom' })
    expect(creates()).toHaveLength(2); expect(db.rows('idempotencyRecord')).toHaveLength(0)
  })

  it('refuses foreign lists before reading or creating a key', async () => {
    expect((await add('parentB')).status).toBe(403)
    expect(creates()).toHaveLength(0); expect(writesTo('idempotencyRecord')).toHaveLength(0)
  })

  it('scopes the same key by user and household', async () => {
    await add('parentA'); await add('teenA')
    const other = await add('parentB', { ...body, listId: 'list-b' })
    expect(other.status).toBe(200); expect(other.headers.get('Idempotency-Replayed')).toBeNull()
    expect((await other.json()).item.added_by).toBe('parent-b')
    expect(creates()).toHaveLength(3)
  })

  it('checks current authentication and feature permission before replay', async () => {
    await add('parentA')
    expect((await add(null)).status).toBe(401)
    const { NextResponse } = require('next/server')
    jest.mocked(featureGate).mockResolvedValue(NextResponse.json({ error: 'Feature unavailable' }, { status: 403 }))
    expect((await add('parentA')).status).toBe(403)
    expect(creates()).toHaveLength(1)
  })

  it('rejects malformed keys, invalid bodies and foreign ingredients without items', async () => {
    expect((await add('parentA', body, 'bad')).status).toBe(400)
    expect((await add('parentA', { ...body, content: ' ' })).status).toBe(400)
    expect((await add('parentA', { ...body, ingredient_id: 'foreign' })).status).toBe(400)
    expect(creates()).toHaveLength(0); expect(db.rows('idempotencyRecord')).toHaveLength(0)
  })

  it('a deleted item stays deleted when its original response is replayed', async () => {
    const first = await add('childA'); const original = await first.json()
    await fakePrisma.listItem.delete({ where: { id: original.item.id } })
    const replay = await add('childA')
    expect(replay.headers.get('Idempotency-Replayed')).toBe('true')
    expect(await replay.json()).toEqual(original)
    expect(db.find('listItem', original.item.id)).toBeUndefined()
    expect(creates()).toHaveLength(1)
  })
})
