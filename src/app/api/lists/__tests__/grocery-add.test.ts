jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('next/headers', () => require('@/__tests__/helpers/two-household').nextHeadersMock)
jest.mock('@/lib/session', () => require('@/__tests__/helpers/two-household').sessionMock)
jest.mock('@/lib/prisma', () => ({ prisma: require('@/__tests__/helpers/two-household').fakePrisma }))
jest.mock('@/lib/feature-gate-server', () => ({ featureGate: jest.fn(async () => null) }))

import { POST } from '../items/grocery-add/route'
import { db, req, writesTo, type UserKey } from '@/__tests__/helpers/two-household'
import { idempotencyRuntime } from '@/lib/idempotency'
import { featureGate } from '@/lib/feature-gate-server'
const KEY = '44444444-4444-4444-8444-444444444444'
const BODY = { listId: 'list-a', content: 'Milk' }
const add = (as: UserKey | null, body: unknown = BODY, key: string | null = KEY) =>
  POST(req({ as, method: 'POST', body, headers: key ? { 'Idempotency-Key': key } : {} }))
const creates = () => writesTo('listItem').filter(x => x.op === 'create')

beforeEach(() => {
  db.reset(); idempotencyRuntime.random = () => 0.99; jest.mocked(featureGate).mockResolvedValue(null)
  db.find('list', 'list-a')!.type = 'grocery'; db.find('list', 'list-b')!.type = 'shopping'
})
it('creates a minimal grocery row attributed to the authenticated child and replays once', async () => {
  const first = await add('childA'); const body = await first.json()
  expect(first.status).toBe(200)
  expect(body.item).toMatchObject({ content: 'Milk', quantity: 1, added_by: 'child-a', notes: null, ingredient_id: null })
  const replay = await add('childA')
  expect(replay.headers.get('Idempotency-Replayed')).toBe('true'); expect(await replay.json()).toEqual(body)
  expect(creates()).toHaveLength(1)
})
it.each(['notes', 'quantity', 'price', 'actingMemberId', 'ingredient_id'])('rejects the unreviewed field %s before writing', async field => {
  expect((await add('parentA', { ...BODY, [field]: field === 'quantity' || field === 'price' ? 2 : 'PRIVATE' })).status).toBe(400)
  expect(creates()).toHaveLength(0); expect(writesTo('idempotencyRecord')).toHaveLength(0)
})
it('requires a valid stable key and bounded grocery text', async () => {
  expect((await add('parentA', BODY, null)).status).toBe(400)
  expect((await add('parentA', BODY, 'bad')).status).toBe(400)
  expect((await add('parentA', { ...BODY, content: ' ' })).status).toBe(400)
  expect((await add('parentA', { ...BODY, content: 'x'.repeat(501) })).status).toBe(400)
  expect((await add('parentA', { ...BODY, listId: '../x' })).status).toBe(400)
  expect(creates()).toHaveLength(0)
})
it('refuses foreign, missing and generic lists without storing a result', async () => {
  expect((await add('parentB')).status).toBe(403)
  expect((await add('parentA', { ...BODY, listId: 'gone' })).status).toBe(404)
  db.find('list', 'list-a')!.type = 'todo'
  expect((await add('parentA')).status).toBe(404)
  expect(creates()).toHaveLength(0); expect(writesTo('idempotencyRecord')).toHaveLength(0)
})
it('reauthorizes authentication, feature and grocery type before replay', async () => {
  await add('parentA')
  expect((await add(null)).status).toBe(401)
  const { NextResponse } = require('next/server')
  jest.mocked(featureGate).mockResolvedValue(NextResponse.json({ error: 'Feature unavailable' }, { status: 403 }))
  expect((await add('parentA')).status).toBe(403)
  jest.mocked(featureGate).mockResolvedValue(null); db.find('list', 'list-a')!.type = 'todo'
  expect((await add('parentA')).status).toBe(404)
  expect(creates()).toHaveLength(1)
})
it('never replays across households or users and refuses changed intent', async () => {
  await add('parentA')
  expect((await add('parentA', { ...BODY, content: 'Rice' })).status).toBe(422)
  const other = await add('parentB', { ...BODY, listId: 'list-b' })
  expect(other.status).toBe(200); expect(other.headers.get('Idempotency-Replayed')).toBeNull()
  const teen = await add('teenA'); expect(teen.headers.get('Idempotency-Replayed')).toBeNull()
  expect(creates()).toHaveLength(3)
})
