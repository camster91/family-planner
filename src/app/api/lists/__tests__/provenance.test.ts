// /api/lists/** after ADR-0007 (#251): the server-side `lists` feature gate
// (O-11), optional amount/unit/ingredient_id with household validation, the
// 409 DUPLICATE_OPEN_ITEM mapping, O-8 and old-shape compatibility.

jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('next/headers', () => require('@/__tests__/helpers/two-household').nextHeadersMock)
jest.mock('@/lib/session', () => require('@/__tests__/helpers/two-household').sessionMock)
jest.mock('@/lib/prisma', () => ({ prisma: require('@/__tests__/helpers/two-household').fakePrisma }))
const mockGate = jest.fn(async (_familyId: string, _key: string): Promise<unknown> => null)
jest.mock('@/lib/feature-gate-server', () => ({
  featureGate: (familyId: string, key: string) => mockGate(familyId, key),
}))

import * as lists from '../route'
import { POST as createList } from '../create/route'
import { GET as getItems } from '../items/route'
import { POST as createItem } from '../items/create/route'
import { PATCH as updateItem } from '../items/update/route'
import { DELETE as deleteItem } from '../items/delete/route'
import {
  db,
  req,
  writesTo,
  expectNoForeignData,
  fakePrisma,
  nextServerMock,
  type UserKey,
} from '@/__tests__/helpers/two-household'
import { idempotencyRuntime } from '@/lib/idempotency'

const KEY = '33333333-3333-4333-8333-333333333333'

function update(as: UserKey, body: Record<string, unknown>, key?: string) {
  return updateItem(req({ as, method: 'PATCH', body, headers: key ? { 'Idempotency-Key': key } : {} }))
}

describe('lists — ADR-0007 API changes', () => {
  beforeEach(() => {
    db.reset()
    mockGate.mockReset()
    mockGate.mockImplementation(async () => null)
    idempotencyRuntime.random = () => 0.99
  })

  afterEach(() => jest.restoreAllMocks())

  it('O-11: every /api/lists/** handler is gated by the lists feature', async () => {
    mockGate.mockImplementation(async () => nextServerMock.NextResponse.json({ error: 'off' }, { status: 403 }))
    const statuses = [
      (await lists.GET(req({ as: 'parentA' }))).status,
      (await lists.DELETE(req({ as: 'parentA', body: { listId: 'list-a' } }))).status,
      (await createList(req({ as: 'parentA', body: { name: 'x', type: 'grocery' } }))).status,
      (await getItems(req({ as: 'parentA', query: { listId: 'list-a' } }))).status,
      (await createItem(req({ as: 'parentA', body: { listId: 'list-a', content: 'eggs' } }))).status,
      (await update('parentA', { itemId: 'item-a', checked: true }, KEY)).status,
      (await deleteItem(req({ as: 'parentA', query: { itemId: 'item-a' } }))).status,
    ]
    expect(new Set(statuses)).toEqual(new Set([403]))
    expect(mockGate).toHaveBeenCalledTimes(7)
    expect(new Set(mockGate.mock.calls.map((c) => `${c[0]}:${c[1]}`))).toEqual(new Set(['family-A:lists']))
    // Nothing written, not even an idempotency record.
    expect(db.writes).toHaveLength(0)
  })

  it('old-shape item bodies still work and responses carry the new fields', async () => {
    const created = await createItem(
      req({ as: 'childA', body: { listId: 'list-a', content: 'Eggs', quantity: 2, category: 'Dairy', notes: 'free range' } })
    )
    expect(created.status).toBe(200)
    const { success, item } = await created.json()
    expect(success).toBe(true)
    expect(item).toMatchObject({
      list_id: 'list-a',
      content: 'Eggs',
      quantity: 2,
      category: 'Dairy',
      notes: 'free range',
      added_by: 'child-a',
      amount: null,
      unit: null,
      ingredient_id: null,
    })
    const ticked = await update('childA', { itemId: 'item-a', checked: true })
    expect(ticked.status).toBe(200)
    expect((await ticked.json()).item).toMatchObject({ id: 'item-a', checked: true, checked_by: 'child-a' })
    const edited = await update('teenA', { itemId: 'item-a', content: 'Oat milk', quantity: 3, category: 'Dairy', notes: 'x' })
    expect(edited.status).toBe(200)
  })

  it('stores amount, unit and a same-family ingredient_id', async () => {
    const res = await createItem(
      req({ as: 'teenA', body: { listId: 'list-a', content: 'Tomatoes', amount: 0.5, unit: 'kg', ingredient_id: 'ingredient-a' } })
    )
    expect(res.status).toBe(200)
    const { item } = await expectNoForeignData(res)
    expect(item).toMatchObject({ amount: 0.5, unit: 'kg', ingredient_id: 'ingredient-a' })
    // The client cannot choose provenance; the column default ('manual') applies.
    expect(writesTo('listItem')[0].args.data).not.toHaveProperty('source')
  })

  it('refuses a foreign ingredient_id on create with the same 400 as a missing one, writing nothing', async () => {
    const foreign = await createItem(req({ as: 'parentA', body: { listId: 'list-a', content: 'x', ingredient_id: 'ingredient-b' } }))
    const missing = await createItem(req({ as: 'parentA', body: { listId: 'list-a', content: 'x', ingredient_id: 'ingredient-q' } }))
    expect(foreign.status).toBe(400)
    await expectNoForeignData(foreign)
    expect(await foreign.json()).toEqual(await missing.json())
    expect(writesTo('listItem')).toHaveLength(0)
  })

  it('refuses a foreign ingredient_id on update and leaves the item unchanged', async () => {
    const res = await update('parentA', { itemId: 'item-a', ingredient_id: 'ingredient-b', amount: 1 }, KEY)
    expect(res.status).toBe(400)
    await expectNoForeignData(res)
    expect(writesTo('listItem')).toHaveLength(0)
    // A non-2xx outcome is not stored, so the key can be retried.
    expect(db.rows('idempotencyRecord')).toHaveLength(0)
    expect(db.find('listItem', 'item-a')!.ingredient_id).toBeUndefined()
  })

  it('updates and clears amount, unit and ingredient_id', async () => {
    const set = await update('childA', { itemId: 'item-a', amount: 2, unit: 'l', ingredient_id: 'ingredient-a' })
    expect((await set.json()).item).toMatchObject({ amount: 2, unit: 'l', ingredient_id: 'ingredient-a' })
    const cleared = await update('childA', { itemId: 'item-a', amount: null, unit: null, ingredient_id: null })
    expect((await cleared.json()).item).toMatchObject({ amount: null, unit: null, ingredient_id: null })
    expect((await update('childA', { itemId: 'item-a', amount: -1 })).status).toBe(400)
    expect((await update('childA', { itemId: 'item-a', unit: '' })).status).toBe(400)
  })

  it('maps the open-recipe-row unique violation to 409 DUPLICATE_OPEN_ITEM and stores nothing', async () => {
    db.find('listItem', 'item-a')!.checked = true
    const p2002 = Object.assign(new Error('Unique constraint failed on ListItem_open_recipe_source_key'), { code: 'P2002' })
    jest.spyOn(fakePrisma.listItem, 'update').mockRejectedValueOnce(p2002)

    const res = await update('childA', { itemId: 'item-a', checked: false }, KEY)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: {
        code: 'DUPLICATE_OPEN_ITEM',
        message: 'This item is already on the list and not yet ticked.',
        retryable: false,
      },
    })
    expect(db.rows('idempotencyRecord')).toHaveLength(0)
  })

  it('O-8: a new list cannot be a meal_plan list, but an existing one keeps working', async () => {
    const res = await createList(req({ as: 'parentA', body: { name: 'Week', type: 'meal_plan' } }))
    expect(res.status).toBe(400)
    expect(writesTo('list')).toHaveLength(0)

    db.find('list', 'list-a')!.type = 'meal_plan'
    expect((await lists.GET(req({ as: 'childA', query: { type: 'meal_plan' } }))).status).toBe(200)
    expect((await createItem(req({ as: 'childA', body: { listId: 'list-a', content: 'Tacos Tuesday' } }))).status).toBe(200)
    expect((await update('childA', { itemId: 'item-a', checked: true })).status).toBe(200)
  })
})
