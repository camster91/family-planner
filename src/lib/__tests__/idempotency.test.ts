/**
 * Server idempotency helper (#162): replay, key reuse, cross-user and
 * cross-household isolation, in-progress duplicates, expiry and pruning.
 * Runs on the two-household fake Prisma, which enforces the (scope, key)
 * unique index like Postgres (P2002).
 */
jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)

import { db, fakePrisma } from '@/__tests__/helpers/two-household'
import {
  hashIdempotentRequest,
  IDEMPOTENCY_LOCK_TIMEOUT_MS,
  IDEMPOTENCY_MAX_BODY_CHARS,
  IDEMPOTENCY_TTL_MS,
  idempotencyRuntime,
  readIdempotencyKey,
  withIdempotency,
  type EffectResult,
  type IdempotencyContext,
} from '../idempotency'
import { IDEMPOTENCY_REPLAYED_HEADER, isValidIdempotencyKey, newIdempotencyKey } from '../idempotency-key'

const KEY = '0b7f3c1e-2d4a-4f6b-9a8c-1e2f3a4b5c6d'
const T0 = new Date('2026-09-26T12:00:00Z')

const ctxA: IdempotencyContext = { scope: 'user:parent-a', familyId: 'family-A', userId: 'parent-a', action: 'test.set' }
const ctxB: IdempotencyContext = { scope: 'user:parent-b', familyId: 'family-B', userId: 'parent-b', action: 'test.set' }

let now = T0
let random = 0.99 // never prune unless a test says so
const realRuntime = { ...idempotencyRuntime }

beforeEach(() => {
  db.reset()
  now = T0
  random = 0.99
  idempotencyRuntime.now = () => now
  idempotencyRuntime.random = () => random
})

afterAll(() => {
  Object.assign(idempotencyRuntime, realRuntime)
})

function counter(result: EffectResult = { status: 200, body: { success: true, n: 1 } }) {
  const fn = jest.fn(async () => result)
  return fn
}

const records = () => db.rows('idempotencyRecord')

describe('idempotency key utility', () => {
  it('generates valid, distinct keys, with and without randomUUID', () => {
    const a = newIdempotencyKey()
    const b = newIdempotencyKey()
    expect(isValidIdempotencyKey(a)).toBe(true)
    expect(a).not.toBe(b)
    const fallback = newIdempotencyKey({ getRandomValues: (arr: any) => require('crypto').getRandomValues(arr) })
    expect(fallback).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('rejects malformed keys', () => {
    for (const bad of ['', 'short', 'x'.repeat(129), 'has space in the key 123', 'semi;colon-1234567890', 42, null]) {
      expect(isValidIdempotencyKey(bad)).toBe(false)
    }
  })

  it('reads the header: absent is fine, invalid is a 400', async () => {
    expect(readIdempotencyKey({ headers: new Headers() })).toEqual({ key: null, error: null })
    expect(readIdempotencyKey({ headers: new Headers({ 'Idempotency-Key': KEY }) }).key).toBe(KEY)
    const bad = readIdempotencyKey({ headers: new Headers({ 'Idempotency-Key': 'nope' }) })
    expect(bad.key).toBeNull()
    expect(bad.error?.status).toBe(400)
    expect((await bad.error!.json()).error.code).toBe('IDEMPOTENCY_KEY_INVALID')
  })

  it('hashes bodies independently of key order', () => {
    expect(hashIdempotentRequest('a', { x: 1, y: [1, { b: 2, a: 1 }] })).toBe(
      hashIdempotentRequest('a', { y: [1, { a: 1, b: 2 }], x: 1 })
    )
    expect(hashIdempotentRequest('a', { x: 1 })).not.toBe(hashIdempotentRequest('b', { x: 1 }))
    expect(hashIdempotentRequest('a', { x: 1 })).not.toBe(hashIdempotentRequest('a', { x: 2 }))
  })
})

describe('withIdempotency', () => {
  it('without a key just runs the effect and stores nothing', async () => {
    const effect = counter()
    const res = await withIdempotency(fakePrisma, null, ctxA, { x: 1 }, effect)
    expect(res.status).toBe(200)
    expect(effect).toHaveBeenCalledTimes(1)
    expect(records()).toHaveLength(0)
  })

  it('same key + same request replays the stored response without running the effect again', async () => {
    const effect = counter({ status: 200, body: { success: true, item: { id: 'item-a', checked: true } } })
    const first = await withIdempotency(fakePrisma, KEY, ctxA, { x: 1 }, effect)
    const second = await withIdempotency(fakePrisma, KEY, ctxA, { x: 1 }, effect)
    expect(effect).toHaveBeenCalledTimes(1)
    expect(first.headers.get(IDEMPOTENCY_REPLAYED_HEADER)).toBeNull()
    expect(second.status).toBe(200)
    expect(second.headers.get(IDEMPOTENCY_REPLAYED_HEADER)).toBe('true')
    expect(await second.json()).toEqual(await first.json())
    expect(records()).toHaveLength(1)
    expect(records()[0]).toMatchObject({
      scope: 'user:parent-a',
      key: KEY,
      family_id: 'family-A',
      user_id: 'parent-a',
      action: 'test.set',
      response_status: 200,
    })
    expect(records()[0].expires_at.getTime()).toBe(T0.getTime() + IDEMPOTENCY_TTL_MS)
    // The request body itself is never stored, only its hash.
    expect(JSON.stringify(records()[0])).not.toContain('"x":1')
  })

  it('same key + different request is 422 IDEMPOTENCY_KEY_REUSED and runs nothing', async () => {
    const effect = counter()
    await withIdempotency(fakePrisma, KEY, ctxA, { x: 1 }, effect)
    const reused = await withIdempotency(fakePrisma, KEY, ctxA, { x: 2 }, effect)
    expect(reused.status).toBe(422)
    expect((await reused.json()).error).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED', retryable: false })
    const otherAction = await withIdempotency(fakePrisma, KEY, { ...ctxA, action: 'test.other' }, { x: 1 }, effect)
    expect(otherAction.status).toBe(422)
    expect(effect).toHaveBeenCalledTimes(1)
  })

  it('keys are scoped per user: another user with the same key gets their own effect, never a replay', async () => {
    const effectA = counter({ status: 200, body: { owner: 'A-secret' } })
    const effectB = counter({ status: 200, body: { owner: 'B' } })
    await withIdempotency(fakePrisma, KEY, ctxA, { x: 1 }, effectA)
    const resB = await withIdempotency(fakePrisma, KEY, ctxB, { x: 1 }, effectB)
    expect(effectB).toHaveBeenCalledTimes(1)
    expect(resB.headers.get(IDEMPOTENCY_REPLAYED_HEADER)).toBeNull()
    expect(JSON.stringify(await resB.json())).not.toContain('A-secret')
    expect(records()).toHaveLength(2)
  })

  it('never replays into another household, even for the same scope (member moved families)', async () => {
    const effect = counter({ status: 200, body: { owner: 'family-A-data' } })
    await withIdempotency(fakePrisma, KEY, ctxA, { x: 1 }, effect)
    const moved = await withIdempotency(fakePrisma, KEY, { ...ctxA, familyId: 'family-B' }, { x: 1 }, effect)
    expect(moved.status).toBe(422)
    expect(JSON.stringify(await moved.json())).not.toContain('family-A-data')
    expect(effect).toHaveBeenCalledTimes(1)
  })

  it('a concurrent duplicate gets 409 IDEMPOTENCY_IN_PROGRESS, then the stored result', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const effect = jest.fn(async () => {
      await gate
      return { status: 200, body: { done: true } }
    })
    const first = withIdempotency(fakePrisma, KEY, ctxA, { x: 1 }, effect)
    const dup = await withIdempotency(fakePrisma, KEY, ctxA, { x: 1 }, effect)
    expect(dup.status).toBe(409)
    expect(dup.headers.get('Retry-After')).toBe('1')
    expect((await dup.json()).error).toMatchObject({ code: 'IDEMPOTENCY_IN_PROGRESS', retryable: true })
    release()
    expect((await first).status).toBe(200)
    const later = await withIdempotency(fakePrisma, KEY, ctxA, { x: 1 }, effect)
    expect(later.headers.get(IDEMPOTENCY_REPLAYED_HEADER)).toBe('true')
    expect(effect).toHaveBeenCalledTimes(1)
  })

  it('takes over an abandoned in-progress record after the lock timeout', async () => {
    records().push({
      id: 'stale', scope: ctxA.scope, key: KEY, family_id: 'family-A', user_id: 'parent-a', action: 'test.set',
      request_hash: hashIdempotentRequest('test.set', { x: 1 }), response_status: null, response_body: null,
      created_at: new Date(T0.getTime() - IDEMPOTENCY_LOCK_TIMEOUT_MS - 1), expires_at: new Date(T0.getTime() + 1000),
    })
    const effect = counter()
    const res = await withIdempotency(fakePrisma, KEY, ctxA, { x: 1 }, effect)
    expect(res.status).toBe(200)
    expect(effect).toHaveBeenCalledTimes(1)
    expect(records()).toHaveLength(1)
    expect(records()[0].response_status).toBe(200)
  })

  it('only stores 2xx: an error releases the key so a retry runs again', async () => {
    const failing = counter({ status: 404, body: { error: 'Item not found' } })
    expect((await withIdempotency(fakePrisma, KEY, ctxA, { x: 1 }, failing)).status).toBe(404)
    expect(records()).toHaveLength(0)
    const ok = counter()
    expect((await withIdempotency(fakePrisma, KEY, ctxA, { x: 1 }, ok)).status).toBe(200)
    expect(ok).toHaveBeenCalledTimes(1)
  })

  it('releases the key when the effect throws', async () => {
    const boom = jest.fn(async (): Promise<EffectResult> => {
      throw new Error('db down')
    })
    await expect(withIdempotency(fakePrisma, KEY, ctxA, { x: 1 }, boom)).rejects.toThrow('db down')
    expect(records()).toHaveLength(0)
  })

  it('an expired record no longer replays: the key starts over', async () => {
    const effect = counter()
    await withIdempotency(fakePrisma, KEY, ctxA, { x: 1 }, effect)
    now = new Date(T0.getTime() + IDEMPOTENCY_TTL_MS + 1)
    const res = await withIdempotency(fakePrisma, KEY, ctxA, { x: 1 }, effect)
    expect(res.headers.get(IDEMPOTENCY_REPLAYED_HEADER)).toBeNull()
    expect(effect).toHaveBeenCalledTimes(2)
    expect(records()).toHaveLength(1)
    expect(records()[0].expires_at.getTime()).toBe(now.getTime() + IDEMPOTENCY_TTL_MS)
  })

  it('prunes expired rows opportunistically and keeps live ones', async () => {
    const effect = counter()
    await withIdempotency(fakePrisma, 'aaaaaaaaaaaaaaaaaaaa', ctxA, { x: 1 }, effect)
    now = new Date(T0.getTime() + IDEMPOTENCY_TTL_MS - 1000)
    await withIdempotency(fakePrisma, 'bbbbbbbbbbbbbbbbbbbb', ctxA, { x: 1 }, effect)
    now = new Date(T0.getTime() + IDEMPOTENCY_TTL_MS + 1)
    random = 0 // this request prunes
    await withIdempotency(fakePrisma, 'cccccccccccccccccccc', ctxB, { x: 1 }, effect)
    expect(records().map((r) => r.key).sort()).toEqual(['bbbbbbbbbbbbbbbbbbbb', 'cccccccccccccccccccc'])
  })

  it('caps the stored body', async () => {
    const big = { success: true, blob: 'x'.repeat(IDEMPOTENCY_MAX_BODY_CHARS) }
    const effect = counter({ status: 200, body: big })
    const first = await withIdempotency(fakePrisma, KEY, ctxA, { x: 1 }, effect)
    expect((await first.json()).blob).toHaveLength(IDEMPOTENCY_MAX_BODY_CHARS)
    const replay = await withIdempotency(fakePrisma, KEY, ctxA, { x: 1 }, effect)
    expect(await replay.json()).toEqual({ success: true })
  })
})
