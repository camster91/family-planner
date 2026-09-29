// "Used it", "Throw away" and Undo (#158/#121) on the two-household harness:
// roles (parent/teen write, child 403), paired device refused, household
// isolation (foreign item and adjustment ids answer like missing ones),
// partial amounts, finished items leaving the active list and use-soon, undo
// conflicts, and Idempotency-Key retries of consume/discard/undo/PATCH/DELETE
// that never duplicate an adjustment or a state change.

jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('next/headers', () => require('@/__tests__/helpers/two-household').nextHeadersMock)
jest.mock('@/lib/session', () => require('@/__tests__/helpers/two-household').sessionMock)
jest.mock('@/lib/prisma', () => ({ prisma: require('@/__tests__/helpers/two-household').fakePrisma }))
const mockGate = jest.fn(async (_familyId: string, _key: string): Promise<unknown> => null)
jest.mock('@/lib/feature-gate-server', () => ({
  featureGate: (familyId: string, key: string) => mockGate(familyId, key),
}))

import * as collection from '../route'
import * as item from '../[id]/route'
import * as consumeRoute from '../[id]/consume/route'
import * as discardRoute from '../[id]/discard/route'
import * as undoRoute from '../adjustments/[id]/undo/route'
import * as history from '../adjustments/route'
import * as useSoon from '../use-soon/route'
import {
  db,
  req,
  params,
  writesTo,
  expectDenied,
  expectNoForeignData,
  nextServerMock,
  type UserKey,
} from '@/__tests__/helpers/two-household'
import { deviceReq, enableSharedDevice, disableSharedDevice, seedDevices } from '@/__tests__/helpers/device'

const P = (id: string) => params({ id })
const KEY = 'inv-adjust-key-0000000001'
const KEY2 = 'inv-adjust-key-0000000002'

function consume(as: UserKey | null, id: string, body?: unknown, key?: string) {
  return consumeRoute.POST(req({ as, method: 'POST', body, headers: key ? { 'Idempotency-Key': key } : {} }), P(id))
}
function discard(as: UserKey | null, id: string, key?: string) {
  return discardRoute.POST(req({ as, method: 'POST', headers: key ? { 'Idempotency-Key': key } : {} }), P(id))
}
function undo(as: UserKey | null, adjustmentId: string, key?: string) {
  return undoRoute.POST(req({ as, method: 'POST', headers: key ? { 'Idempotency-Key': key } : {} }), P(adjustmentId))
}
function patch(as: UserKey, id: string, body: unknown, key?: string) {
  return item.PATCH(req({ as, method: 'PATCH', body, headers: key ? { 'Idempotency-Key': key } : {} }), P(id))
}
function remove(as: UserKey, id: string, key?: string) {
  return item.DELETE(req({ as, method: 'DELETE', headers: key ? { 'Idempotency-Key': key } : {} }), P(id))
}
const listIds = async (as: UserKey, query: Record<string, string> = {}) =>
  (await (await collection.GET(req({ as, query }))).json()).items.map((i: any) => i.id)
const useSoonIds = async (as: UserKey) => (await (await useSoon.GET(req({ as }))).json()).items.map((i: any) => i.id)
const adjustments = () => db.rows('inventoryAdjustment')

describe('inventory consume / discard / undo', () => {
  beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  beforeEach(() => {
    db.reset()
    mockGate.mockReset()
    mockGate.mockImplementation(async () => null)
  })

  it('401 without a session on every new handler, writing nothing', async () => {
    const statuses = [
      (await consume(null, 'inv-a')).status,
      (await discard(null, 'inv-a')).status,
      (await undo(null, 'adj-x')).status,
      (await history.GET(req())).status,
    ]
    expect(new Set(statuses)).toEqual(new Set([401]))
    expect(db.writes).toHaveLength(0)
  })

  it('a paired shared device is refused (403) before person auth', async () => {
    enableSharedDevice()
    try {
      const fx = seedDevices()
      const csrf = 'c'.repeat(64)
      const opts = { method: 'POST', cookies: { ...fx.d1.cookies, csrf_token: csrf }, headers: { 'x-csrf-token': csrf }, body: {} }
      for (const res of [
        await consumeRoute.POST(deviceReq({ ...opts, path: '/api/inventory/inv-a/consume' }), P('inv-a')),
        await discardRoute.POST(deviceReq({ ...opts, path: '/api/inventory/inv-a/discard' }), P('inv-a')),
        await undoRoute.POST(deviceReq({ ...opts, path: '/api/inventory/adjustments/x/undo' }), P('x')),
      ]) {
        expect(res.status).toBe(403)
        expect((await res.json()).error.code).toBe('DEVICE_WRITE_NOT_ALLOWED')
      }
      expect(adjustments()).toHaveLength(0)
    } finally {
      disableSharedDevice()
    }
  })

  it('a child may read history but not consume, discard or undo (403 INVENTORY_WRITE_FORBIDDEN)', async () => {
    const done = await (await consume('parentA', 'inv-a')).json()
    const before = db.writes.length
    for (const res of [
      await consume('childA', 'inv-a'),
      await discard('childA', 'inv-a'),
      await undo('childA', done.adjustment.id),
    ]) {
      expect(res.status).toBe(403)
      expect((await res.json()).error.code).toBe('INVENTORY_WRITE_FORBIDDEN')
    }
    expect(db.writes).toHaveLength(before)
    const seen = await history.GET(req({ as: 'childA' }))
    expect(seen.status).toBe(200)
    expect((await seen.json()).adjustments.map((a: any) => a.id)).toEqual([done.adjustment.id])
  })

  it('a teen uses all of an item: it leaves the list and use-soon, and one adjustment is recorded', async () => {
    expect(await listIds('parentA')).toEqual(['inv-a'])
    expect(await useSoonIds('parentA')).toEqual(['inv-a'])
    const res = await consume('teenA', 'inv-a')
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    const body = await expectNoForeignData(res)
    expect(body.item).toMatchObject({ id: 'inv-a', status: 'consumed', amount: 3 })
    expect(body.item.finished_at).toEqual(expect.any(String))
    expect(body.adjustment).toMatchObject({
      item_id: 'inv-a',
      kind: 'consume',
      amount_delta: -3,
      amount_before: 3,
      amount_after: 3,
      status_before: 'active',
      status_after: 'consumed',
      actor_id: 'teen-a',
      undone_at: null,
    })
    expect(body.adjustment).not.toHaveProperty('family_id')
    expect(body.adjustment).not.toHaveProperty('request_id')
    expect(adjustments()).toHaveLength(1)
    expect(adjustments()[0].family_id).toBe('family-A')
    expect(await listIds('parentA')).toEqual([])
    expect(await useSoonIds('parentA')).toEqual([])
    // Still readable by id (so Undo can show it), with its status.
    expect((await (await item.GET(req({ as: 'childA' }), P('inv-a'))).json()).item.status).toBe('consumed')
    // A finished item cannot be used, thrown away or edited again.
    for (const again of [await consume('teenA', 'inv-a'), await discard('teenA', 'inv-a'), await patch('teenA', 'inv-a', { name: 'x' })]) {
      expect(again.status).toBe(409)
      expect((await again.json()).error).toEqual({
        code: 'INVENTORY_ITEM_FINISHED',
        message: 'This item was already used up or thrown away.',
        retryable: false,
      })
    }
    expect(adjustments()).toHaveLength(1)
  })

  it('uses part of an item: the rest stays active; a use at least the amount finishes it', async () => {
    const part = await (await consume('parentA', 'inv-a', { amount: 1.2 })).json()
    expect(part.item).toMatchObject({ status: 'active', amount: 1.8 })
    expect(part.adjustment).toMatchObject({ amount_delta: -1.2, amount_before: 3, amount_after: 1.8, status_after: 'active' })
    expect(await listIds('parentA')).toEqual(['inv-a'])
    const rest = await (await consume('parentA', 'inv-a', { amount: 5 })).json()
    expect(rest.item).toMatchObject({ status: 'consumed', amount: 1.8 })
    expect(rest.adjustment).toMatchObject({ amount_delta: -1.8, status_after: 'consumed' })
    expect(adjustments()).toHaveLength(2)
  })

  it('validates the consume body; a partial amount needs an item amount', async () => {
    for (const body of [{ amount: 0 }, { amount: -2 }, { amount: 'lots' }, { amount: 1, extra: true }]) {
      const res = await consume('parentA', 'inv-a', body)
      expect(res.status).toBe(400)
      expect((await res.json()).error.code).toBe('VALIDATION_ERROR')
    }
    db.find('inventoryItem', 'inv-a')!.amount = null
    const noAmount = await consume('parentA', 'inv-a', { amount: 1 })
    expect(noAmount.status).toBe(400)
    expect((await noAmount.json()).error.message).toMatch(/no amount/)
    // Using all of an item without an amount records a null delta.
    const all = await (await consume('parentA', 'inv-a', {})).json()
    expect(all.adjustment).toMatchObject({ amount_delta: null, amount_before: null, status_after: 'consumed' })
    const badDiscard = await discardRoute.POST(req({ as: 'parentA', method: 'POST', body: { amount: 1 } }), P('inv-a'))
    expect(badDiscard.status).toBe(400)
  })

  it('throw away, then Undo puts it back; a second Undo is a no-op success', async () => {
    const thrown = await (await discard('parentA', 'inv-a')).json()
    expect(thrown.item.status).toBe('discarded')
    expect(thrown.adjustment).toMatchObject({ kind: 'discard', amount_delta: -3, status_after: 'discarded' })
    expect(await listIds('parentA')).toEqual([])

    const res = await undo('teenA', thrown.adjustment.id)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ alreadyUndone: false, item: { id: 'inv-a', status: 'active', amount: 3, finished_at: null } })
    expect(body.adjustment.undone_at).toEqual(expect.any(String))
    expect(db.find('inventoryAdjustment', thrown.adjustment.id)!.undone_by).toBe('teen-a')
    expect(await listIds('parentA')).toEqual(['inv-a'])
    expect(await useSoonIds('parentA')).toEqual(['inv-a'])

    const again = await (await undo('teenA', thrown.adjustment.id)).json()
    expect(again).toMatchObject({ alreadyUndone: true, item: { status: 'active', amount: 3 } })
    expect(adjustments()).toHaveLength(1)
  })

  it('Undo of a partial use restores the amount; Undo after a later change is 409', async () => {
    const part = await (await consume('parentA', 'inv-a', { amount: 1 })).json()
    const back = await (await undo('parentA', part.adjustment.id)).json()
    expect(back.item).toMatchObject({ status: 'active', amount: 3 })

    const first = await (await consume('parentA', 'inv-a', { amount: 1 })).json()
    await patch('parentA', 'inv-a', { location: 'pantry' })
    const conflict = await undo('parentA', first.adjustment.id)
    expect(conflict.status).toBe(409)
    expect((await conflict.json()).error.code).toBe('INVENTORY_UNDO_CONFLICT')
    expect(db.find('inventoryItem', 'inv-a')!.amount).toBe(2)

    // Only the latest change to an item can be undone: an older adjustment is
    // 409 while a newer one exists, and stays 409 after the newer one is
    // undone (the undo is itself a change).
    const second = await (await consume('parentA', 'inv-a', { amount: 1 })).json()
    const third = await (await consume('parentA', 'inv-a')).json()
    expect((await undo('parentA', second.adjustment.id)).status).toBe(409)
    expect((await undo('parentA', third.adjustment.id)).status).toBe(200)
    expect((await undo('parentA', second.adjustment.id)).status).toBe(409)
    expect(db.find('inventoryItem', 'inv-a')!).toMatchObject({ status: 'active', amount: 1 })
  })

  it('another household cannot consume, discard, undo or list: same 404 as missing, no writes', async () => {
    const own = await (await discard('parentB', 'inv-b')).json()
    const before = db.writes.length
    for (const [foreign, missing] of [
      [await consume('parentA', 'inv-b'), await consume('parentA', 'inv-nope')],
      [await discard('teenA', 'inv-b'), await discard('teenA', 'inv-nope')],
    ]) {
      await expectDenied(foreign, [404])
      expect(await foreign.json()).toEqual(await missing.json())
    }
    const foreignUndo = await undo('parentA', own.adjustment.id)
    await expectDenied(foreignUndo, [404])
    expect(await foreignUndo.json()).toEqual(await (await undo('parentA', 'adj-nope')).json())
    expect((await undo('parentA', 'adj-nope')).status).toBe(404)
    expect(db.writes.filter((w) => w.op !== 'deleteMany').length).toBe(before)
    expect(db.find('inventoryItem', 'inv-b')!.status).toBe('discarded')

    const listA = await history.GET(req({ as: 'parentA' }))
    const bodyA = await expectNoForeignData(listA)
    expect(bodyA.adjustments).toEqual([])
    const listB = await (await history.GET(req({ as: 'parentB' }))).json()
    expect(listB.adjustments.map((a: any) => a.id)).toEqual([own.adjustment.id])
    expect(listB.adjustments[0]).not.toHaveProperty('family_id')
    // Filtering by a foreign item id shows nothing.
    const filtered = await (await history.GET(req({ as: 'parentA', query: { itemId: 'inv-b' } }))).json()
    expect(filtered.adjustments).toEqual([])
    for (const query of [{ limit: '0' }, { limit: '101' }, { offset: '-1' }, { itemId: '' }] as Array<Record<string, string>>) {
      expect((await history.GET(req({ as: 'parentA', query }))).status).toBe(400)
    }
  })

  it('history is newest first with the item name and status, and paginated', async () => {
    const a = await (await consume('parentA', 'inv-a', { amount: 1 })).json()
    const b = await (await consume('parentA', 'inv-a', { amount: 1 })).json()
    // Same millisecond possible in the fake: order by created_at then id, both desc.
    db.find('inventoryAdjustment', b.adjustment.id)!.created_at = new Date(Date.now() + 1000)
    const page1 = await (await history.GET(req({ as: 'parentA', query: { limit: '1' } }))).json()
    expect(page1.adjustments.map((x: any) => x.id)).toEqual([b.adjustment.id])
    expect(page1.adjustments[0]).toMatchObject({ item_name: 'Home Tomato', item_status: 'active' })
    expect(page1.nextOffset).toBe(1)
    const page2 = await (await history.GET(req({ as: 'parentA', query: { limit: '1', offset: '1' } }))).json()
    expect(page2.adjustments.map((x: any) => x.id)).toEqual([a.adjustment.id])
    expect(page2.nextOffset).toBeNull()
  })

  it('every new handler is gated by the inventory feature', async () => {
    mockGate.mockImplementation(async () => nextServerMock.NextResponse.json({ error: 'off' }, { status: 403 }))
    const statuses = [
      (await consume('parentA', 'inv-a')).status,
      (await discard('parentA', 'inv-a')).status,
      (await undo('parentA', 'x')).status,
      (await history.GET(req({ as: 'parentA' }))).status,
    ]
    expect(new Set(statuses)).toEqual(new Set([403]))
    expect(db.writes).toHaveLength(0)
  })

  describe('retries with an Idempotency-Key never duplicate', () => {
    it('consume: the same key replays the stored 200 and writes one adjustment; another body is 422', async () => {
      const first = await consume('parentA', 'inv-a', { amount: 1 }, KEY)
      expect(first.status).toBe(200)
      const firstBody = await first.json()
      const again = await consume('parentA', 'inv-a', { amount: 1 }, KEY)
      expect(again.status).toBe(200)
      expect(again.headers.get('Idempotency-Replayed')).toBe('true')
      expect((await again.json()).adjustment.id).toBe(firstBody.adjustment.id)
      expect(adjustments()).toHaveLength(1)
      expect(db.find('inventoryItem', 'inv-a')!.amount).toBe(2)
      const reused = await consume('parentA', 'inv-a', { amount: 2 }, KEY)
      expect(reused.status).toBe(422)
      expect((await reused.json()).error.code).toBe('IDEMPOTENCY_KEY_REUSED')
      // The same key on another route (different action) is also 422.
      expect((await discard('parentA', 'inv-a', KEY)).status).toBe(422)
      expect(adjustments()).toHaveLength(1)
      // The adjustment carries the idempotency record id.
      const record = db.rows('idempotencyRecord').find((r: any) => r.key === KEY)!
      expect(adjustments()[0].request_id).toBe(record.id)
    })

    it('a request that crashed after writing converges on re-run (no second adjustment)', async () => {
      const { adjustInventoryItem } = await import('@/lib/inventory-adjust')
      const { fakePrisma } = await import('@/__tests__/helpers/two-household')
      const run = () =>
        adjustInventoryItem(fakePrisma, {
          familyId: 'family-A',
          itemId: 'inv-a',
          actorId: 'parent-a',
          kind: 'discard',
          requestId: 'idem-record-1',
        })
      const first = await run()
      const second = await run()
      expect(first.ok && second.ok).toBe(true)
      expect(second.ok && second.replayed).toBe(true)
      expect(first.ok && second.ok && second.adjustment.id === first.adjustment.id).toBe(true)
      expect(adjustments()).toHaveLength(1)
    })

    it('discard and undo replay; PATCH replays; DELETE replays 200 instead of 404', async () => {
      const thrown = await (await discard('parentA', 'inv-a', KEY)).json()
      expect((await discard('parentA', 'inv-a', KEY)).status).toBe(200)
      expect(adjustments()).toHaveLength(1)

      const u1 = await undo('parentA', thrown.adjustment.id, KEY2)
      const u2 = await undo('parentA', thrown.adjustment.id, KEY2)
      expect(u1.status).toBe(200)
      expect(u2.status).toBe(200)
      expect(u2.headers.get('Idempotency-Replayed')).toBe('true')
      expect(db.find('inventoryItem', 'inv-a')!.status).toBe('active')

      const pKey = 'inv-patch-key-00000000001'
      const p1 = await patch('parentA', 'inv-a', { location: 'freezer' }, pKey)
      expect(p1.status).toBe(200)
      const updatesBefore = writesTo('inventoryItem').filter((w) => w.op === 'updateMany').length
      const p2 = await patch('parentA', 'inv-a', { location: 'freezer' }, pKey)
      expect(p2.headers.get('Idempotency-Replayed')).toBe('true')
      expect(writesTo('inventoryItem').filter((w) => w.op === 'updateMany').length).toBe(updatesBefore)
      // Same key for another item is a different request.
      expect((await patch('parentA', 'inv-b', { location: 'freezer' }, pKey)).status).toBe(422)
      expect(db.find('inventoryItem', 'inv-b')!.location).toBe('fridge')

      const dKey = 'inv-delete-key-0000000001'
      expect((await remove('parentA', 'inv-a', dKey)).status).toBe(200)
      const d2 = await remove('parentA', 'inv-a', dKey)
      expect(d2.status).toBe(200)
      expect(d2.headers.get('Idempotency-Replayed')).toBe('true')
      // Without a key the second delete is an honest 404.
      expect((await remove('parentA', 'inv-a')).status).toBe(404)
      // Deleting the item removes its history with it (FK cascade in Postgres; see the integration test).
    })

    it('rejects a malformed key with 400 before writing', async () => {
      for (const res of [
        await consume('parentA', 'inv-a', {}, 'short'),
        await discard('parentA', 'inv-a', 'bad key!'),
        await undo('parentA', 'x', 'nope'),
        await patch('parentA', 'inv-a', { name: 'x' }, 'short'),
        await remove('parentA', 'inv-a', 'short'),
      ]) {
        expect(res.status).toBe(400)
        expect((await res.json()).error.code).toBe('IDEMPOTENCY_KEY_INVALID')
      }
      expect(db.writes).toHaveLength(0)
    })
  })

  it('search and category filters stay inside the household', async () => {
    db.rows('inventoryItem').push(
      { id: 'inv-a-cheese', family_id: 'family-A', name: 'Aged Cheddar', ingredient_id: null, amount: null, unit: null, location: 'fridge', expires_on: null, category: 'dairy_eggs', added_by: null, created_at: new Date(), updated_at: new Date() },
      { id: 'inv-b-cheese', family_id: 'family-B', name: 'FOREIGN cheddar', ingredient_id: null, amount: null, unit: null, location: 'fridge', expires_on: null, category: 'dairy_eggs', added_by: null, created_at: new Date(), updated_at: new Date() }
    )
    expect(await listIds('parentA', { q: 'CHEDD' })).toEqual(['inv-a-cheese'])
    expect(await listIds('parentA', { category: 'dairy_eggs' })).toEqual(['inv-a-cheese'])
    expect(await listIds('parentA', { q: 'tomato', category: 'dairy_eggs' })).toEqual([])
    for (const query of [{ category: 'garage' }, { q: 'x'.repeat(101) }] as Array<Record<string, string>>) {
      const res = await collection.GET(req({ as: 'parentA', query }))
      expect(res.status).toBe(400)
      expect((await res.json()).error.code).toBe('VALIDATION_ERROR')
    }
  })

  it('create and edit store date kind, category and purchased/opened days; use-by past is not use-soon', async () => {
    const created = await (
      await collection.POST(
        req({
          as: 'teenA',
          method: 'POST',
          body: { name: 'Chicken thighs', expires_on: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10), date_kind: 'use_by', category: 'meat_fish', purchased_on: '2026-01-02', opened_on: '2026-01-03' },
        })
      )
    ).json()
    expect(created.item).toMatchObject({ date_kind: 'use_by', category: 'meat_fish', purchased_on: '2026-01-02', opened_on: '2026-01-03', status: 'active' })
    expect(created.item.expiry.status).toBe('past_use_by')
    expect(await useSoonIds('parentA')).toEqual(['inv-a'])
    // Switching the kind to best before brings it back as "check it".
    const edited = await (await patch('teenA', created.item.id, { date_kind: 'best_before', category: null, opened_on: null })).json()
    expect(edited.item).toMatchObject({ date_kind: 'best_before', category: null, opened_on: null, expiry: { status: 'expired' } })
    expect(await useSoonIds('parentA')).toEqual([created.item.id, 'inv-a'])
  })
})
