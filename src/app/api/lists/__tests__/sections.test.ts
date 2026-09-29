// Grocery store sections (#273) on the two-household fake: the resolved
// `section` on list item DTOs, "Move to…" (PATCH /api/lists/items/section),
// the per-list switch (PATCH /api/lists/section-sort), walking-order trips
// recorded by ticks, roles, the shared-device refusal and household
// isolation of overrides. The Postgres upsert/uniqueness lives in
// sections.integration.test.ts.

jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('next/headers', () => require('@/__tests__/helpers/two-household').nextHeadersMock)
jest.mock('@/lib/session', () => require('@/__tests__/helpers/two-household').sessionMock)
jest.mock('@/lib/prisma', () => ({ prisma: require('@/__tests__/helpers/two-household').fakePrisma }))
const mockGate = jest.fn(async (_familyId: string, _key: string): Promise<unknown> => null)
jest.mock('@/lib/feature-gate-server', () => ({
  featureGate: (familyId: string, key: string) => mockGate(familyId, key),
}))

import { GET as getItems } from '../items/route'
import { POST as createItem } from '../items/create/route'
import { PATCH as updateItem } from '../items/update/route'
import { PATCH as moveItem } from '../items/section/route'
import { PATCH as sectionSort } from '../section-sort/route'
import {
  db,
  req,
  writesTo,
  expectNoForeignData,
  nextServerMock,
  FAMILY_A,
  FAMILY_B,
  fakePrisma,
  type UserKey,
} from '@/__tests__/helpers/two-household'
import { hashDeviceToken } from '@/lib/device-session'
import { GROCERY_SECTIONS } from '@/lib/grocery-sections'
import { SHOPPING_SESSION_GAP_MS } from '@/lib/grocery-section-store'

const T0 = new Date('2026-09-01T00:00:00Z')

function move(as: UserKey | null, body: unknown) {
  return moveItem(req({ as, method: 'PATCH', body }))
}
function sort(as: UserKey | null, body: unknown) {
  return sectionSort(req({ as, method: 'PATCH', body }))
}
async function items(as: UserKey, listId = 'list-a') {
  const res = await getItems(req({ as, query: { listId } }))
  expect(res.status).toBe(200)
  return res.json()
}
function addRow(id: string, listId: string, content: string, extra: Record<string, unknown> = {}) {
  db.rows('listItem').push({
    id, list_id: listId, content, quantity: 1, category: null, notes: null, checked: false,
    checked_by: null, checked_at: null, added_by: listId === 'list-a' ? 'parent-a' : 'parent-b',
    position: 10, created_at: T0, ingredient_id: null, ...extra,
  })
}

describe('grocery store sections (#273)', () => {
  beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  beforeEach(() => {
    db.reset()
    mockGate.mockReset()
    mockGate.mockImplementation(async () => null)
    // A todo list in household A, to prove sections stay off it.
    db.rows('list').push({
      id: 'todo-a', family_id: FAMILY_A, name: 'Weekend', type: 'todo', description: null,
      created_by: 'parent-a', created_at: T0, updated_at: T0,
    })
    addRow('todo-item', 'todo-a', 'Buy milk')
  })

  afterEach(() => {
    delete process.env.SHARED_DEVICE_ENABLED
  })

  it('returns 401 to an unauthenticated caller on both new routes, writing nothing', async () => {
    expect((await move(null, { itemId: 'item-a', section: 'household' })).status).toBe(401)
    expect((await sort(null, { listId: 'list-a', sortBySection: false })).status).toBe(401)
    expect(db.writes).toHaveLength(0)
  })

  it('GET items: grocery rows carry a resolved section and the list says how to group; a todo list is unchanged', async () => {
    addRow('bananas', 'list-a', 'Bananas')
    addRow('mystery', 'list-a', 'Zzyzx widget')
    const body = await expectNoForeignData(await getItems(req({ as: 'childA', query: { listId: 'list-a' } })))
    const byId = Object.fromEntries(body.items.map((i: any) => [i.id, i.section]))
    expect(byId).toEqual({ 'item-a': 'dairy_eggs', bananas: 'produce', mystery: 'other' })
    expect(body.items[0]).not.toHaveProperty('ingredient')
    expect(body.sectionSort).toEqual({ enabled: true, order: [...GROCERY_SECTIONS], learned: false })

    const todo = await items('childA', 'todo-a')
    expect(todo.items[0]).not.toHaveProperty('section')
    expect(todo).not.toHaveProperty('sectionSort')
  })

  it('POST create returns the section on a grocery row only', async () => {
    const grocery = await createItem(req({ as: 'childA', method: 'POST', body: { listId: 'list-a', content: 'Frozen peas' } }))
    expect((await grocery.json()).item.section).toBe('frozen')
    const todo = await createItem(req({ as: 'childA', method: 'POST', body: { listId: 'todo-a', content: 'Frozen peas' } }))
    expect((await todo.json()).item).not.toHaveProperty('section')
  })

  it.each<[UserKey]>([['parentA'], ['teenA'], ['childA']])('%s may move an item; the override is keyed by normalized name', async (who) => {
    addRow('milk-2', 'list-a', '  HOME   milk ')
    const res = await move(who, { itemId: 'item-a', section: 'household' })
    expect(res.status).toBe(200)
    const body = await expectNoForeignData(res)
    expect(body).toEqual({ nameKey: 'home milk', override: 'household', sections: { 'item-a': 'household', 'milk-2': 'household' } })
    const prefs = db.rows('grocerySectionPreference')
    expect(prefs).toHaveLength(1)
    expect(prefs[0]).toMatchObject({ family_id: FAMILY_A, name_key: 'home milk', section: 'household' })
    // The next read resolves it from the override.
    const again = await items('childA')
    expect(again.items.find((i: any) => i.id === 'milk-2').section).toBe('household')
  })

  it('moving again updates the same override; null clears it back to automatic', async () => {
    await move('parentA', { itemId: 'item-a', section: 'household' })
    await move('teenA', { itemId: 'item-a', section: 'frozen' })
    expect(db.rows('grocerySectionPreference')).toHaveLength(1)
    expect(db.rows('grocerySectionPreference')[0]).toMatchObject({ section: 'frozen', updated_by: 'teen-a' })
    const cleared = await (await move('childA', { itemId: 'item-a', section: null })).json()
    expect(cleared).toEqual({ nameKey: 'home milk', override: null, sections: { 'item-a': 'dairy_eggs' } })
    expect(db.rows('grocerySectionPreference')).toHaveLength(0)
  })

  it('a linked row also sets the ingredient section, only in its own household', async () => {
    addRow('tom', 'list-a', 'Tomatoes', { ingredient_id: 'ingredient-a' })
    addRow('tom-2', 'list-a', 'Roma', { ingredient_id: 'ingredient-a' })
    const body = await (await move('parentA', { itemId: 'tom', section: 'pantry' })).json()
    expect(body.sections).toEqual({ tom: 'pantry', 'tom-2': 'pantry' })
    expect(db.find('ingredient', 'ingredient-a')!.section).toBe('pantry')
    expect(db.find('ingredient', 'ingredient-b')!.section).toBeUndefined()
    // Clearing resets the ingredient too.
    await move('parentA', { itemId: 'tom', section: null })
    expect(db.find('ingredient', 'ingredient-a')!.section).toBeNull()
  })

  it('two households: overrides never cross, and a foreign item is a 404 identical to a missing one', async () => {
    // Both households have a row with the same text.
    addRow('b-bananas', 'list-b', 'Bananas')
    addRow('a-bananas', 'list-a', 'Bananas')
    await move('parentA', { itemId: 'a-bananas', section: 'snacks_drinks' })
    const b = await items('parentB', 'list-b')
    expect(b.items.find((i: any) => i.id === 'b-bananas').section).toBe('produce')
    await move('parentB', { itemId: 'b-bananas', section: 'frozen' })
    const a = await items('parentA')
    expect(a.items.find((i: any) => i.id === 'a-bananas').section).toBe('snacks_drinks')
    expect(db.rows('grocerySectionPreference').map((p) => [p.family_id, p.section]).sort()).toEqual([
      [FAMILY_A, 'snacks_drinks'],
      [FAMILY_B, 'frozen'],
    ])

    const writes = db.writes.length
    const foreign = await move('parentA', { itemId: 'item-b', section: 'household' })
    const missing = await move('parentA', { itemId: 'item-zzz', section: 'household' })
    expect(foreign.status).toBe(404)
    await expectNoForeignData(foreign)
    expect(await foreign.json()).toEqual(await missing.json())
    expect((await missing.json()).error.code).toBe('ITEM_NOT_FOUND')
    expect(db.writes).toHaveLength(writes)
  })

  it('refuses a non-grocery list, an unknown section and extra body keys', async () => {
    const todo = await move('parentA', { itemId: 'todo-item', section: 'household' })
    expect(todo.status).toBe(400)
    expect((await todo.json()).error.code).toBe('LIST_NOT_GROCERY')
    for (const body of [
      { itemId: 'item-a', section: 'aisle-9' },
      { itemId: 'item-a' },
      { itemId: 'item-a', section: 'household', family_id: FAMILY_B },
      { section: 'household' },
    ]) {
      const res = await move('parentA', body)
      expect(res.status).toBe(400)
      expect((await res.json()).error.code).toBe('VALIDATION_ERROR')
    }
    expect(writesTo('grocerySectionPreference')).toHaveLength(0)
  })

  it('section-sort: parent and teen switch it; a child gets 403; the page payload follows', async () => {
    const child = await sort('childA', { listId: 'list-a', sortBySection: false })
    expect(child.status).toBe(403)
    expect((await child.json()).error.code).toBe('SECTION_SORT_FORBIDDEN')
    expect(writesTo('list')).toHaveLength(0)

    const off = await sort('teenA', { listId: 'list-a', sortBySection: false })
    expect(off.status).toBe(200)
    expect(await off.json()).toEqual({ listId: 'list-a', sortBySection: false })
    expect((await items('childA')).sectionSort.enabled).toBe(false)
    const on = await sort('parentA', { listId: 'list-a', sortBySection: true })
    expect((await on.json()).sortBySection).toBe(true)
    expect(db.find('list', 'list-b')!.sort_by_section).toBeUndefined()
  })

  it('section-sort: foreign list is a 404 like a missing one; a todo list is 400; bad bodies are 400', async () => {
    const foreign = await sort('parentA', { listId: 'list-b', sortBySection: false })
    const missing = await sort('parentA', { listId: 'list-zzz', sortBySection: false })
    expect(foreign.status).toBe(404)
    expect(await foreign.json()).toEqual(await missing.json())
    expect((await sort('parentA', { listId: 'todo-a', sortBySection: false })).status).toBe(400)
    expect((await sort('parentA', { listId: 'list-a', sortBySection: 'no' })).status).toBe(400)
    expect((await sort('parentA', { listId: 'list-a', sortBySection: false, family_id: FAMILY_B })).status).toBe(400)
    expect(writesTo('list')).toHaveLength(0)
  })

  it('both routes need the lists feature', async () => {
    mockGate.mockImplementation(async () => nextServerMock.NextResponse.json({ error: 'off' }, { status: 403 }))
    expect((await move('parentA', { itemId: 'item-a', section: 'household' })).status).toBe(403)
    expect((await sort('parentA', { listId: 'list-a', sortBySection: false })).status).toBe(403)
    expect(db.writes).toHaveLength(0)
  })

  it('a paired shared device gets 403 DEVICE_WRITE_NOT_ALLOWED on both routes, even with a person cookie', async () => {
    process.env.SHARED_DEVICE_ENABLED = '1'
    const future = new Date(Date.now() + 60 * 60 * 1000)
    db.rows('householdDevice').push({ id: 'dev-a', family_id: FAMILY_A, revoked_at: null })
    db.rows('deviceSession').push({
      id: 'ds-a', device_id: 'dev-a', family_id: FAMILY_A, access_token_hash: hashDeviceToken('tablet-token'),
      refresh_token_hash: 'x', access_expires_at: future, refresh_expires_at: future, revoked_at: null, rotated_at: null,
    })
    const writes = db.writes.length
    for (const [handler, body] of [
      [moveItem, { itemId: 'item-a', section: 'household' }],
      [sectionSort, { listId: 'list-a', sortBySection: false }],
    ] as const) {
      const r = req({ as: 'parentA', method: 'PATCH', body })
      r.cookies = { get: (n: string) => (n === 'fp_device' ? { value: 'tablet-token' } : n === 'session_token' ? { value: 'session:parent-a' } : undefined) }
      const res = await handler(r)
      expect(res.status).toBe(403)
      expect((await res.json()).error.code).toBe('DEVICE_WRITE_NOT_ALLOWED')
    }
    expect(db.writes).toHaveLength(writes)
  })
})

describe('walking order: ticks record shopping trips (#273)', () => {
  function tick(as: UserKey, itemId: string, checked = true) {
    return updateItem(req({ as, method: 'PATCH', body: { itemId, checked } }))
  }
  const trips = (familyId = FAMILY_A) => db.rows('groceryShoppingSession').filter((s) => s.family_id === familyId)

  beforeEach(() => {
    db.reset()
    mockGate.mockImplementation(async () => null)
    addRow('bananas', 'list-a', 'Bananas')
    addRow('soap', 'list-a', 'Dish soap')
    addRow('bananas-2', 'list-a', 'Apples')
  })

  it('appends each section once, in first-tick order, to the list’s current trip', async () => {
    expect((await tick('childA', 'soap')).status).toBe(200)
    expect((await tick('teenA', 'bananas')).status).toBe(200)
    expect((await tick('parentA', 'item-a')).status).toBe(200)
    expect((await tick('parentA', 'bananas-2')).status).toBe(200)
    expect(trips()).toHaveLength(1)
    expect(trips()[0]).toMatchObject({ list_id: 'list-a', sections: ['household', 'produce', 'dairy_eggs'] })
    expect(trips(FAMILY_B)).toHaveLength(0)
  })

  it('records nothing for an untick, a no-op re-tick or a todo list', async () => {
    await tick('parentA', 'soap')
    const before = JSON.stringify(trips())
    await tick('parentA', 'soap') // already ticked: attribution kept, no new record
    await tick('parentA', 'soap', false)
    expect(JSON.stringify(trips())).toBe(before)

    db.rows('list').push({ id: 'todo-a', family_id: FAMILY_A, name: 'Todo', type: 'todo', created_by: 'parent-a', created_at: T0, updated_at: T0 })
    addRow('todo-item', 'todo-a', 'Bananas')
    await tick('parentA', 'todo-item')
    expect(trips()).toHaveLength(1)
  })

  it('starts a new trip after the gap', async () => {
    await tick('parentA', 'soap')
    trips()[0].last_tick_at = new Date(Date.now() - SHOPPING_SESSION_GAP_MS - 60_000)
    await tick('parentA', 'bananas')
    expect(trips().map((t) => t.sections)).toEqual([['household'], ['produce']])
  })

  it('learns the order after three trips with two or more sections', async () => {
    const old = new Date(Date.now() - 24 * 60 * 60 * 1000)
    for (let i = 0; i < 3; i++) {
      db.rows('groceryShoppingSession').push({
        id: `trip-${i}`, family_id: FAMILY_A, list_id: 'list-a', sections: ['household', 'dairy_eggs', 'produce'],
        started_at: old, last_tick_at: old,
      })
    }
    // Another household's trips never influence household A.
    db.rows('groceryShoppingSession').push({
      id: 'trip-b', family_id: FAMILY_B, list_id: 'list-b', sections: ['personal_care', 'bakery'], started_at: old, last_tick_at: old,
    })
    const body = await items('childA')
    expect(body.sectionSort.learned).toBe(true)
    const order: string[] = body.sectionSort.order
    expect(order[0]).toBe('household')
    expect(order.indexOf('household')).toBeLessThan(order.indexOf('dairy_eggs'))
    expect(order.indexOf('dairy_eggs')).toBeLessThan(order.indexOf('produce'))
    expect(order[order.length - 1]).toBe('other')
    const b = await items('parentB', 'list-b')
    expect(b.sectionSort.learned).toBe(false)
  })

  it('a failure while recording never fails the tick', async () => {
    const spy = jest.spyOn(fakePrisma.groceryShoppingSession, 'findFirst').mockRejectedValue(new Error('boom'))
    const logged = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const res = await tick('parentA', 'soap')
    spy.mockRestore()
    // One privacy-safe line (docs/architecture/OBSERVABILITY.md): the helper's
    // name and the error class, never the exception message.
    expect(logged).toHaveBeenCalledTimes(1)
    const line = String(logged.mock.calls[0][0])
    expect(line).toContain('route.error')
    expect(line).toContain('list-item-update.section-tick')
    expect(line).toContain('"errorName":"Error"')
    expect(line).not.toContain('boom')
    expect(res.status).toBe(200)
    expect(db.find('listItem', 'soap')!.checked).toBe(true)
  })
})
