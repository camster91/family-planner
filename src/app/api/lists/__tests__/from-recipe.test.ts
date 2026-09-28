// Recipe → grocery add and undo (ADR-0007 child D, #253) on the two-household
// fake: idempotency (required key, replay, 422), the duplicate rules (partial
// unique index, checked rows, other sources, free-text lookalikes), roles, the
// shared-device refusal, household isolation of recipe/meal/list/ingredient
// ids, the compact response bound and the undo rules. The Postgres races live
// in from-recipe.integration.test.ts.

jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('next/headers', () => require('@/__tests__/helpers/two-household').nextHeadersMock)
jest.mock('@/lib/session', () => require('@/__tests__/helpers/two-household').sessionMock)
jest.mock('@/lib/prisma', () => ({ prisma: require('@/__tests__/helpers/two-household').fakePrisma }))
const mockGate = jest.fn(async (_familyId: string, _key: string): Promise<unknown> => null)
jest.mock('@/lib/feature-gate-server', () => ({
  featureGate: (familyId: string, key: string) => mockGate(familyId, key),
}))

import { POST as fromRecipe } from '../items/from-recipe/route'
import { POST as undoAdd } from '../items/undo-add/route'
import { POST as defaultGrocery } from '../default-grocery/route'
import {
  db,
  req,
  writesTo,
  expectDenied,
  expectNoForeignData,
  nextServerMock,
  FAMILY_A,
  type UserKey,
} from '@/__tests__/helpers/two-household'
import { IDEMPOTENCY_MAX_BODY_CHARS, idempotencyRuntime } from '@/lib/idempotency'
import { hashDeviceToken } from '@/lib/device-session'
import { POSSIBLE_DUPLICATES_LIMIT, UNDO_WINDOW_MS } from '@/lib/grocery-from-recipe'

let keySeq = 0
const newKey = () => `unit-key-${String(++keySeq).padStart(12, '0')}`

function add(as: UserKey, body: Record<string, unknown>, key: string | null = newKey()) {
  return fromRecipe(req({ as, method: 'POST', body, headers: key ? { 'Idempotency-Key': key } : {} }))
}

function undo(as: UserKey, requestId: string) {
  return undoAdd(req({ as, method: 'POST', body: { requestId } }))
}

const recipeRows = () => db.rows('listItem').filter((r) => r.source === 'recipe')

describe('POST /api/lists/items/from-recipe', () => {
  beforeEach(() => {
    db.reset()
    mockGate.mockReset()
    mockGate.mockImplementation(async () => null)
    idempotencyRuntime.random = () => 0.99
    // meal-a plans recipe-a (4 servings; 400 g Home Tomato) for 8 people.
    Object.assign(db.find('familyMeal', 'meal-a')!, { recipe_id: 'recipe-a', servings: 8 })
  })

  afterEach(() => {
    delete process.env.SHARED_DEVICE_ENABLED
  })

  it('requires a valid Idempotency-Key and writes nothing without one', async () => {
    const missing = await add('parentA', { recipeId: 'recipe-a' }, null)
    expect(missing.status).toBe(400)
    expect((await missing.json()).error.code).toBe('IDEMPOTENCY_KEY_REQUIRED')
    const invalid = await add('parentA', { recipeId: 'recipe-a' }, 'short')
    expect(invalid.status).toBe(400)
    expect((await invalid.json()).error.code).toBe('IDEMPOTENCY_KEY_INVALID')
    expect(writesTo('listItem')).toHaveLength(0)
  })

  it('adds scaled rows with provenance and a compact body; the same key replays without writing', async () => {
    const key = newKey()
    const body = { recipeId: 'recipe-a', mealId: 'meal-a', listId: 'list-a' }
    const res = await add('parentA', body, key)
    expect(res.status).toBe(201)
    const out = await res.json()
    expect(out).toEqual({
      listId: 'list-a',
      listName: 'Home groceries',
      requestId: expect.any(String),
      createdCount: 1,
      alreadyOnListCount: 0,
      possibleDuplicates: [],
      possibleDuplicatesTruncated: false,
    })
    const [row] = recipeRows()
    expect(row).toMatchObject({
      list_id: 'list-a',
      content: 'Home Tomato',
      quantity: 1,
      amount: 800,
      unit: 'g',
      ingredient_id: 'ingredient-a',
      recipe_id: 'recipe-a',
      meal_id: 'meal-a',
      source_key: 'meal:meal-a',
      source_request_id: out.requestId,
      added_by: 'parent-a',
      position: 2,
    })
    // The request id is the idempotency record that ran the effect.
    expect(db.find('idempotencyRecord', out.requestId)).toMatchObject({ action: 'grocery.add-from-recipe', user_id: 'parent-a' })

    const writes = writesTo('listItem').length
    const replay = await add('parentA', { ...body }, key)
    expect(replay.status).toBe(201)
    expect(replay.headers.get('Idempotency-Replayed')).toBe('true')
    expect(await replay.json()).toEqual(out)
    expect(writesTo('listItem')).toHaveLength(writes)

    // Reordered/duplicated ingredientIds hash the same as the canonical form.
    const k2 = newKey()
    expect((await add('parentA', { recipeId: 'recipe-a', ingredientIds: ['ingredient-a'] }, k2)).status).toBe(201)
    const again = await add('parentA', { recipeId: 'recipe-a', ingredientIds: ['ingredient-a', 'ingredient-a'] }, k2)
    expect(again.headers.get('Idempotency-Replayed')).toBe('true')

    const reused = await add('parentA', { ...body, servings: 2 }, key)
    expect(reused.status).toBe(422)
    expect((await reused.json()).error.code).toBe('IDEMPOTENCY_KEY_REUSED')
  })

  it('a second key for the same meal is already on the list; checked rows do not block', async () => {
    const body = { recipeId: 'recipe-a', mealId: 'meal-a' }
    expect((await (await add('parentA', body)).json()).createdCount).toBe(1)
    const second = await (await add('teenA', body)).json()
    expect(second).toMatchObject({ createdCount: 0, alreadyOnListCount: 1 })
    expect(recipeRows()).toHaveLength(1)

    recipeRows()[0].checked = true
    const third = await (await add('parentA', body)).json()
    expect(third).toMatchObject({ createdCount: 1, alreadyOnListCount: 0 })
    expect(recipeRows()).toHaveLength(2)
  })

  it('another meal, or the recipe alone, is another source with its own row', async () => {
    db.rows('familyMeal').push({ ...db.find('familyMeal', 'meal-a')!, id: 'meal-a2', servings: null })
    await add('parentA', { recipeId: 'recipe-a', mealId: 'meal-a' })
    const other = await (await add('parentA', { recipeId: 'recipe-a', mealId: 'meal-a2' })).json()
    expect(other.createdCount).toBe(1)
    const plain = await (await add('parentA', { recipeId: 'recipe-a' })).json()
    expect(plain.createdCount).toBe(1)
    expect(recipeRows().map((r) => [r.source_key, r.amount])).toEqual([
      ['meal:meal-a', 800],
      ['meal:meal-a2', 400],
      ['recipe:recipe-a', 400],
    ])
    // Explicit servings win over the meal's.
    const scaled = await add('parentA', { recipeId: 'recipe-a', mealId: 'meal-a2', servings: 2, listId: 'list-a' })
    expect((await scaled.json()).alreadyOnListCount).toBe(1)
  })

  it('flags a free-text lookalike instead of merging it', async () => {
    db.rows('listItem').push({
      id: 'free-tomato', list_id: 'list-a', content: '  home   TOMATO ', quantity: 1, checked: false,
      ingredient_id: null, added_by: 'parent-a', position: 3, created_at: new Date(),
    })
    const out = await (await add('parentA', { recipeId: 'recipe-a' })).json()
    expect(out.createdCount).toBe(1)
    expect(out.possibleDuplicates).toEqual([{ ingredientId: 'ingredient-a', matchedItemId: 'free-tomato' }])
    expect(db.find('listItem', 'free-tomato')).toMatchObject({ content: '  home   TOMATO ', ingredient_id: null })
    expect(db.rows('listItem').filter((r) => r.list_id === 'list-a' && !r.checked)).toHaveLength(3)
  })

  it('parent, teen and child may add; a paired shared device gets 403 before anything runs', async () => {
    for (const who of ['parentA', 'teenA', 'childA'] as UserKey[]) {
      expect((await add(who, { recipeId: 'recipe-a', mealId: 'meal-a' })).status).toBe(201)
    }

    process.env.SHARED_DEVICE_ENABLED = '1'
    const future = new Date(Date.now() + 60 * 60 * 1000)
    db.rows('householdDevice').push({ id: 'dev-a', family_id: FAMILY_A, revoked_at: null })
    db.rows('deviceSession').push({
      id: 'ds-a', device_id: 'dev-a', family_id: FAMILY_A, access_token_hash: hashDeviceToken('tablet-token'),
      refresh_token_hash: 'x', access_expires_at: future, refresh_expires_at: future, revoked_at: null, rotated_at: null,
    })
    const writes = db.writes.length
    for (const handler of [fromRecipe, undoAdd]) {
      const r = req({ as: 'parentA', method: 'POST', body: { recipeId: 'recipe-a', requestId: 'x' }, headers: { 'Idempotency-Key': newKey() } })
      // A stray person cookie next to a live device credential does not open the route.
      r.cookies = { get: (n: string) => (n === 'fp_device' ? { value: 'tablet-token' } : n === 'session_token' ? { value: 'session:parent-a' } : undefined) }
      const res = await handler(r)
      expect(res.status).toBe(403)
      expect((await res.json()).error.code).toBe('DEVICE_WRITE_NOT_ALLOWED')
    }
    expect(db.writes).toHaveLength(writes)
  })

  it('needs both the meals and the lists feature', async () => {
    for (const off of ['meals', 'lists']) {
      mockGate.mockImplementation(async (_f, k) =>
        k === off ? nextServerMock.NextResponse.json({ error: 'off' }, { status: 403 }) : null
      )
      expect((await add('parentA', { recipeId: 'recipe-a' })).status).toBe(403)
    }
    expect(writesTo('listItem')).toHaveLength(0)
  })

  it('two households: foreign recipe, meal, list and ingredient ids are refused like missing ones', async () => {
    Object.assign(db.find('familyMeal', 'meal-b')!, { recipe_id: 'recipe-b' })
    const cases: Array<[Record<string, unknown>, number]> = [
      [{ recipeId: 'recipe-b' }, 404],
      [{ recipeId: 'recipe-missing' }, 404],
      [{ recipeId: 'recipe-a', mealId: 'meal-b' }, 404],
      [{ recipeId: 'recipe-b', mealId: 'meal-b' }, 404],
      [{ recipeId: 'recipe-a', listId: 'list-b' }, 404],
      [{ recipeId: 'recipe-a', ingredientIds: ['ingredient-b'] }, 400],
    ]
    for (const [body, status] of cases) {
      const res = await add('parentA', body)
      await expectDenied(res, [status])
    }
    // And the other direction.
    await expectDenied(await add('parentB', { recipeId: 'recipe-a' }), [404])
    await expectDenied(await add('childB', { recipeId: 'recipe-b', mealId: 'meal-a' }), [404])
    await expectDenied(await add('parentB', { recipeId: 'recipe-b', listId: 'list-a' }), [404])
    expect(writesTo('listItem')).toHaveLength(0)
    expect(writesTo('list')).toHaveLength(0)
    // Refusals are never stored for replay.
    expect(db.rows('idempotencyRecord')).toHaveLength(0)
  })

  it('refuses a meal of another recipe, a non-grocery list and unknown body keys', async () => {
    const mismatch = await add('parentA', { recipeId: 'recipe-a', mealId: 'meal-a2-missing' })
    expect(mismatch.status).toBe(404)
    db.find('familyMeal', 'meal-a')!.recipe_id = null
    const unlinked = await add('parentA', { recipeId: 'recipe-a', mealId: 'meal-a' })
    expect(unlinked.status).toBe(400)
    expect((await unlinked.json()).error.code).toBe('MEAL_RECIPE_MISMATCH')

    db.rows('list').push({ ...db.find('list', 'list-a')!, id: 'todo-a', type: 'todo' })
    const todo = await add('parentA', { recipeId: 'recipe-a', listId: 'todo-a' })
    expect(todo.status).toBe(400)
    expect((await todo.json()).error.code).toBe('LIST_NOT_GROCERY')

    expect((await add('parentA', { recipeId: 'recipe-a', source: 'manual' })).status).toBe(400)
    expect((await add('parentA', { recipeId: 'recipe-a', servings: 51 })).status).toBe(400)
    expect(writesTo('listItem')).toHaveLength(0)
  })

  it('without listId uses the household grocery list, or creates "Groceries" once', async () => {
    const first = await (await add('parentA', { recipeId: 'recipe-a' })).json()
    expect(first.listId).toBe('list-a')
    expect(writesTo('list')).toHaveLength(0)

    db.tables.list = db.rows('list').filter((l) => l.id !== 'list-a')
    const created = await (await add('childA', { recipeId: 'recipe-a' })).json()
    expect(created.listName).toBe('Groceries')
    expect(db.find('list', created.listId)).toMatchObject({ family_id: FAMILY_A, type: 'grocery', created_by: 'child-a' })
    const reused = await (await add('parentA', { recipeId: 'recipe-a', mealId: 'meal-a' })).json()
    expect(reused.listId).toBe(created.listId)
    expect(writesTo('list')).toHaveLength(1)
  })

  it('stays under the replay cap at 100 ingredients with maximal ids and many lookalikes', async () => {
    const recipe = db.find('recipe', 'recipe-a')!
    db.tables.recipeIngredient = []
    const long = (p: string, i: number) => `${p}${String(i).padStart(3, '0')}`.padEnd(128, 'x')
    const ids: string[] = []
    for (let i = 0; i < 100; i++) {
      const id = long('ing', i)
      ids.push(id)
      db.rows('ingredient').push({ id, family_id: FAMILY_A, name: `Thing ${i}`, unit: 'g' })
      db.rows('recipeIngredient').push({ id: `ri${i}`, recipe_id: recipe.id, ingredient_id: id, amount: 1, unit: null })
      db.rows('listItem').push({
        id: long('item', i), list_id: 'list-a', content: `thing ${i}`, checked: false, ingredient_id: null,
        quantity: 1, added_by: 'parent-a', position: 10 + i, created_at: new Date(),
      })
    }
    db.find('list', 'list-a')!.name = 'L'.repeat(200)
    const res = await add('parentA', { recipeId: 'recipe-a', ingredientIds: ids })
    const out = await res.json()
    expect(out.createdCount).toBe(100)
    expect(out.possibleDuplicates).toHaveLength(POSSIBLE_DUPLICATES_LIMIT)
    expect(out.possibleDuplicatesTruncated).toBe(true)
    expect(JSON.stringify(out).length).toBeLessThan(IDEMPOTENCY_MAX_BODY_CHARS)
    // Stored verbatim, not collapsed to { success: true }.
    expect(db.find('idempotencyRecord', out.requestId)!.response_body).toEqual(out)
  })
})

describe('POST /api/lists/items/undo-add', () => {
  beforeEach(() => {
    db.reset()
    mockGate.mockReset()
    mockGate.mockImplementation(async () => null)
    idempotencyRuntime.random = () => 0.99
  })

  async function addAs(who: UserKey, body: Record<string, unknown> = { recipeId: 'recipe-a' }) {
    const res = await add(who, body)
    expect(res.status).toBe(201)
    return res.json()
  }

  it('removes only that request’s unticked rows, for its author', async () => {
    db.rows('ingredient').push({ id: 'ingredient-a2', family_id: FAMILY_A, name: 'Basil', unit: null })
    db.rows('recipeIngredient').push({ id: 'ri-a2', recipe_id: 'recipe-a', ingredient_id: 'ingredient-a2', amount: 1, unit: null })
    const mine = await addAs('childA')
    Object.assign(db.find('familyMeal', 'meal-a')!, { recipe_id: 'recipe-a' })
    const other = await addAs('childA', { recipeId: 'recipe-a', mealId: 'meal-a' })
    const [ticked] = recipeRows().filter((r) => r.source_request_id === mine.requestId)
    ticked.checked = true

    await expectDenied(await undo('parentA', mine.requestId), [403])
    await expectDenied(await undo('parentB', mine.requestId), [404])
    await expectDenied(await undo('childA', 'no-such-request'), [404])

    const res = await undo('childA', mine.requestId)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ requestId: mine.requestId, removedCount: 1, keptCheckedCount: 1 })
    expect(recipeRows().filter((r) => r.source_request_id === mine.requestId)).toEqual([ticked])
    expect(recipeRows().filter((r) => r.source_request_id === other.requestId)).toHaveLength(2)
    expect(await (await undo('childA', mine.requestId)).json()).toMatchObject({ removedCount: 0 })
  })

  it('refuses after 10 minutes and for a record of another action', async () => {
    const out = await addAs('parentA')
    const record = db.find('idempotencyRecord', out.requestId)!
    record.created_at = new Date(Date.now() - UNDO_WINDOW_MS - 1000)
    const late = await undo('parentA', out.requestId)
    expect(late.status).toBe(409)
    expect((await late.json()).error.code).toBe('UNDO_WINDOW_EXPIRED')
    expect(recipeRows()).toHaveLength(1)

    record.created_at = new Date()
    record.action = 'list-item.update'
    expect((await undo('parentA', out.requestId)).status).toBe(404)
    expect(recipeRows()).toHaveLength(1)
  })

  it('does not remove rows another person added under the same request id', async () => {
    const out = await addAs('parentA')
    recipeRows()[0].added_by = 'teen-a'
    expect(await (await undo('parentA', out.requestId)).json()).toMatchObject({ removedCount: 0 })
    expect(recipeRows()).toHaveLength(1)
  })
})

describe('POST /api/lists/default-grocery', () => {
  beforeEach(() => {
    db.reset()
    mockGate.mockReset()
    mockGate.mockImplementation(async () => null)
  })

  it('returns the household grocery list, creates one only when none exists, and is parent/teen only', async () => {
    const found = await defaultGrocery(req({ as: 'teenA', method: 'POST' }))
    expect(found.status).toBe(200)
    expect(await expectNoForeignData(found)).toEqual({ list: { id: 'list-a', name: 'Home groceries', type: 'grocery' }, created: false })

    expect((await defaultGrocery(req({ as: 'childA', method: 'POST' }))).status).toBe(403)
    expect((await defaultGrocery(req({ as: null, method: 'POST' }))).status).toBe(401)

    db.tables.list = db.rows('list').filter((l) => l.family_id !== FAMILY_A)
    const created = await (await defaultGrocery(req({ as: 'parentA', method: 'POST' }))).json()
    expect(created).toMatchObject({ list: { name: 'Groceries', type: 'grocery' }, created: true })
    const again = await (await defaultGrocery(req({ as: 'parentA', method: 'POST' }))).json()
    expect(again).toMatchObject({ list: { id: created.list.id }, created: false })
  })
})
