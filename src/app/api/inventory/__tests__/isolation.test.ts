// /api/inventory/** (#263): two households, roles (parent/teen write, child
// read), the `inventory` feature gate (plus `meals` for "what can I cook"),
// foreign ids answered like missing ones, and no cross-household ingredient
// links.

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
import * as useSoon from '../use-soon/route'
import * as cook from '../cook/route'
import { getCookSuggestions } from '@/lib/inventory'
import {
  db,
  req,
  params,
  writesTo,
  expectDenied,
  expectNoForeignData,
  nextServerMock,
  FOREIGN,
  fakePrisma,
  type UserKey,
} from '@/__tests__/helpers/two-household'

const P = (id: string) => params({ id })
const utcToday = () => new Date().toISOString().slice(0, 10)
const utcPlus = (n: number) => {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function create(as: UserKey | null, body: unknown, query: Record<string, string> = {}) {
  return collection.POST(req({ as, method: 'POST', body, query }))
}
function patch(as: UserKey | null, id: string, body: unknown) {
  return item.PATCH(req({ as, method: 'PATCH', body }), P(id))
}
function remove(as: UserKey | null, id: string) {
  return item.DELETE(req({ as, method: 'DELETE' }), P(id))
}
function list(as: UserKey | null, query: Record<string, string> = {}) {
  return collection.GET(req({ as, query }))
}

describe('inventory — two households, roles and gates', () => {
  beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  beforeEach(() => {
    db.reset()
    mockGate.mockReset()
    mockGate.mockImplementation(async () => null)
  })

  it('returns 401 to an unauthenticated caller on every handler, writing nothing', async () => {
    const statuses = [
      (await list(null)).status,
      (await create(null, { name: 'x' })).status,
      (await item.GET(req(), P('inv-a'))).status,
      (await patch(null, 'inv-a', { name: 'x' })).status,
      (await remove(null, 'inv-a')).status,
      (await useSoon.GET(req())).status,
      (await cook.GET(req())).status,
    ]
    expect(new Set(statuses)).toEqual(new Set([401]))
    expect(db.writes).toHaveLength(0)
  })

  it('lists only the caller household, for every role, with date-only expiry and a status', async () => {
    for (const who of ['parentA', 'teenA', 'childA'] as UserKey[]) {
      const res = await list(who)
      expect(res.status).toBe(200)
      const body = await expectNoForeignData(res)
      expect(body.items.map((i: any) => i.id)).toEqual(['inv-a'])
      expect(body.items[0]).toMatchObject({
        name: 'Home Tomato',
        location: 'fridge',
        expires_on: utcPlus(2),
        expiry: { status: 'soon', daysLeft: 2 },
      })
      expect(body.items[0]).not.toHaveProperty('family_id')
      expect(body.nextOffset).toBeNull()
    }
  })

  it('filters by location and expiry window, and validates the query', async () => {
    db.rows('inventoryItem').push(
      { id: 'inv-a2', family_id: 'family-A', name: 'Peas', ingredient_id: null, amount: null, unit: null, location: 'freezer', expires_on: null, added_by: 'parent-a', created_at: new Date(), updated_at: new Date() },
      { id: 'inv-a3', family_id: 'family-A', name: 'Old yogurt', ingredient_id: null, amount: null, unit: null, location: 'fridge', expires_on: new Date(`${utcPlus(-3)}T00:00:00Z`), added_by: 'parent-a', created_at: new Date(), updated_at: new Date() }
    )
    const freezer = await (await list('childA', { location: 'freezer' })).json()
    expect(freezer.items.map((i: any) => i.id)).toEqual(['inv-a2'])
    const soon1 = await (await list('childA', { expiringWithinDays: '1' })).json()
    expect(soon1.items.map((i: any) => i.id)).toEqual(['inv-a3'])
    expect(soon1.items[0].expiry).toEqual({ status: 'expired', daysLeft: -3 })
    const soon2 = await (await list('childA', { expiringWithinDays: '2' })).json()
    expect(soon2.items.map((i: any) => i.id).sort()).toEqual(['inv-a', 'inv-a3'])
    const paged = await (await list('childA', { limit: '1' })).json()
    expect(paged.items).toHaveLength(1)
    expect(paged.nextOffset).toBe(1)

    for (const query of <Array<Record<string, string>>>[
      { location: 'garage' },
      { expiringWithinDays: '-1' },
      { expiringWithinDays: 'soon' },
      { limit: '0' },
      { limit: '501' },
      { today: '2020-01-01' },
      { today: 'yesterday' },
    ]) {
      const res = await list('childA', query)
      expect(res.status).toBe(400)
      expect((await res.json()).error.code).toBe('VALIDATION_ERROR')
    }
  })

  it('answers a cross-family read exactly like a missing id', async () => {
    const foreign = await item.GET(req({ as: 'parentA' }), P('inv-b'))
    const missing = await item.GET(req({ as: 'parentA' }), P('inv-nope'))
    expect(foreign.status).toBe(404)
    await expectDenied(foreign, [404])
    expect(await foreign.json()).toEqual(await missing.json())
    const own = await item.GET(req({ as: 'childA' }), P('inv-a'))
    expect(own.status).toBe(200)
    expect((await own.json()).item.id).toBe('inv-a')
  })

  it('a teen creates an item; it links to the household ingredient by normalized name and creates no ingredient', async () => {
    const res = await create('teenA', {
      name: '  home   TOMATO ',
      amount: 2,
      unit: 'pcs',
      location: 'pantry',
      expires_on: utcPlus(5),
    })
    expect(res.status).toBe(201)
    const body = await expectNoForeignData(res)
    expect(body.item).toMatchObject({
      name: 'home TOMATO',
      ingredient_id: 'ingredient-a',
      amount: 2,
      unit: 'pcs',
      location: 'pantry',
      expires_on: utcPlus(5),
      added_by: 'teen-a',
      expiry: { status: 'later', daysLeft: 5 },
    })
    const row = db.find('inventoryItem', body.item.id)!
    expect(row.family_id).toBe('family-A')
    expect(writesTo('ingredient')).toHaveLength(0)
  })

  it('an unmatched name stays free text; defaults to the fridge with no date', async () => {
    const res = await create('parentA', { name: 'Leftover lasagne' })
    expect(res.status).toBe(201)
    const { item: created } = await res.json()
    expect(created).toMatchObject({ ingredient_id: null, location: 'fridge', expires_on: null, amount: null, unit: null })
    expect(created.expiry).toEqual({ status: 'none', daysLeft: null })
    expect(writesTo('ingredient')).toHaveLength(0)
  })

  it('never links to another household ingredient by name', async () => {
    const res = await create('parentA', { name: 'FOREIGN tomato' })
    expect(res.status).toBe(201)
    const { item: created } = await res.json()
    expect(created.ingredient_id).toBeNull()
  })

  it('refuses a foreign ingredient_id with the same 400 as a missing one, writing nothing', async () => {
    const foreign = await create('parentA', { name: 'Tomato', ingredient_id: 'ingredient-b' })
    const missing = await create('parentA', { name: 'Tomato', ingredient_id: 'ingredient-zzz' })
    expect(foreign.status).toBe(400)
    await expectNoForeignData(foreign)
    expect(await foreign.json()).toEqual(await missing.json())
    expect(writesTo('inventoryItem')).toHaveLength(0)
    // An explicit same-household id is accepted; null keeps it free text.
    const ok = await create('parentA', { name: 'Tinned tomatoes', ingredient_id: 'ingredient-a' })
    expect((await ok.json()).item.ingredient_id).toBe('ingredient-a')
    const free = await create('parentA', { name: 'Home Tomato', ingredient_id: null })
    expect((await free.json()).item.ingredient_id).toBeNull()
  })

  it('a body cannot choose the household or the author, and bad input is 400', async () => {
    for (const body of [
      { name: 'x', family_id: 'family-B' },
      { name: 'x', added_by: 'parent-b' },
      { name: '' },
      { name: 'x', location: 'garage' },
      { name: 'x', expires_on: '2026-02-31' },
    ]) {
      const res = await create('parentA', body)
      expect(res.status).toBe(400)
      expect((await res.json()).error.code).toBe('VALIDATION_ERROR')
    }
    const notJson = await collection.POST({ ...req({ as: 'parentA', method: 'POST' }), json: async () => { throw new SyntaxError('x') } })
    expect(notJson.status).toBe(400)
    expect(writesTo('inventoryItem')).toHaveLength(0)
  })

  it('a child may read but not create, edit or delete', async () => {
    for (const res of [
      await create('childA', { name: 'x' }),
      await patch('childA', 'inv-a', { name: 'x' }),
      await remove('childA', 'inv-a'),
    ]) {
      expect(res.status).toBe(403)
      expect((await res.json()).error.code).toBe('INVENTORY_WRITE_FORBIDDEN')
    }
    expect(db.writes).toHaveLength(0)
  })

  it('refuses to update or delete another household item (same 404 as missing, no writes)', async () => {
    const foreignPatch = await patch('parentA', 'inv-b', { name: 'mine now' })
    const missingPatch = await patch('parentA', 'inv-nope', { name: 'mine now' })
    await expectDenied(foreignPatch, [404])
    expect(await foreignPatch.json()).toEqual(await missingPatch.json())
    const foreignDelete = await remove('teenA', 'inv-b')
    await expectDenied(foreignDelete, [404])
    expect(await foreignDelete.json()).toEqual(await (await remove('teenA', 'inv-nope')).json())
    expect(writesTo('inventoryItem').filter((w) => w.op !== 'deleteMany')).toHaveLength(0)
    expect(db.find('inventoryItem', 'inv-b')!.name).toBe(`${FOREIGN} Tomato`)
    // A foreign ingredient in a PATCH body is refused and leaves the item unchanged.
    const injected = await patch('parentA', 'inv-a', { ingredient_id: 'ingredient-b' })
    expect(injected.status).toBe(400)
    expect(db.find('inventoryItem', 'inv-a')!.ingredient_id).toBe('ingredient-a')
  })

  it('PATCH updates fields; renaming re-links by name; null clears', async () => {
    const renamed = await patch('teenA', 'inv-a', { name: 'Cherry tomatoes', location: 'pantry', expires_on: null })
    expect(renamed.status).toBe(200)
    expect((await renamed.json()).item).toMatchObject({
      name: 'Cherry tomatoes',
      ingredient_id: null,
      location: 'pantry',
      expires_on: null,
    })
    const back = await patch('teenA', 'inv-a', { name: 'home tomato', amount: null })
    expect((await back.json()).item).toMatchObject({ ingredient_id: 'ingredient-a', amount: null })
    // A PATCH without a name keeps the link.
    const dated = await patch('teenA', 'inv-a', { expires_on: utcToday() })
    expect((await dated.json()).item).toMatchObject({ ingredient_id: 'ingredient-a', expiry: { status: 'today', daysLeft: 0 } })
    expect((await patch('teenA', 'inv-a', {})).status).toBe(400)
    expect(db.find('inventoryItem', 'inv-b')!.location).toBe('fridge')
  })

  it('a teen deletes a same-household item; the other household keeps its own', async () => {
    const res = await remove('teenA', 'inv-a')
    expect(res.status).toBe(200)
    expect(db.find('inventoryItem', 'inv-a')).toBeUndefined()
    expect(db.find('inventoryItem', 'inv-b')).toBeDefined()
    expect((await remove('teenA', 'inv-a')).status).toBe(404)
  })

  it('use-soon returns expired and soon items with text labels, household-scoped', async () => {
    db.rows('inventoryItem').push({
      id: 'inv-a-old', family_id: 'family-A', name: 'Old yogurt', ingredient_id: null, amount: null, unit: null,
      location: 'fridge', expires_on: new Date(`${utcPlus(-1)}T00:00:00Z`), added_by: 'parent-a', created_at: new Date(), updated_at: new Date(),
    })
    const res = await useSoon.GET(req({ as: 'childA' }))
    expect(res.status).toBe(200)
    const body = await expectNoForeignData(res)
    expect(body.days).toBe(3)
    expect(body.items).toEqual([
      { id: 'inv-a-old', name: 'Old yogurt', location: 'fridge', expiresOn: utcPlus(-1), daysLeft: -1, status: 'expired', label: 'Expired yesterday' },
      { id: 'inv-a', name: 'Home Tomato', location: 'fridge', expiresOn: utcPlus(2), daysLeft: 2, status: 'soon', label: 'Use in 2 days' },
    ])
    const narrow = await (await useSoon.GET(req({ as: 'childA', query: { days: '1' } }))).json()
    expect(narrow.items.map((i: any) => i.id)).toEqual(['inv-a-old'])
    expect((await useSoon.GET(req({ as: 'childA', query: { days: '400' } }))).status).toBe(400)
  })

  it('what can I cook reports inputsTruncated when a recipe or item cap is hit, and never ranks expired items', async () => {
    const today = new Date(`${utcToday()}T00:00:00Z`)
    const row = (id: string, expires: string | null) => ({
      id, family_id: 'family-A', name: 'Home Tomato', ingredient_id: 'ingredient-a', amount: null, unit: null,
      location: 'fridge', expires_on: expires ? new Date(`${expires}T00:00:00Z`) : null, added_by: 'parent-a',
      created_at: new Date(), updated_at: new Date(),
    })
    // Uncapped: one recipe, one non-expired item.
    const full = await getCookSuggestions(fakePrisma, 'family-A', { today })
    expect(full).toMatchObject({ recipesConsidered: 1, truncated: false, inputsTruncated: false })
    expect(full.suggestions.map((s) => s.recipeId)).toEqual(['recipe-a'])

    // Recipe cap hit: a second recipe (no ingredients) exists past the cap.
    db.rows('recipe').push({ ...db.find('recipe', 'recipe-a')!, id: 'recipe-a2', title: 'Zucchini bake' })
    const recipesCut = await getCookSuggestions(fakePrisma, 'family-A', { today, recipeCap: 1 })
    expect(recipesCut).toMatchObject({ recipesConsidered: 1, inputsTruncated: true })

    // Item cap hit.
    db.rows('inventoryItem').push(row('inv-a-extra', null))
    const itemsCut = await getCookSuggestions(fakePrisma, 'family-A', { today, inventoryCap: 1 })
    expect(itemsCut.inputsTruncated).toBe(true)

    // Expired items are filtered in the query, so they never use up the cap.
    db.tables.inventoryItem = db.rows('inventoryItem').filter((r) => r.family_id !== 'family-A')
    db.rows('inventoryItem').push(row('inv-a-old1', utcPlus(-2)), row('inv-a-old2', utcPlus(-1)), row('inv-a-ok', utcPlus(1)))
    const expiredSkipped = await getCookSuggestions(fakePrisma, 'family-A', { today, inventoryCap: 1 })
    expect(expiredSkipped.inputsTruncated).toBe(false)
    expect(expiredSkipped.suggestions.map((s) => s.recipeId)).toEqual(['recipe-a'])

    // The route exposes the flag.
    const body = await (await cook.GET(req({ as: 'parentA' }))).json()
    expect(body.inputsTruncated).toBe(false)
  })

  it('what can I cook ranks the household recipes by in-stock ingredients, never another household', async () => {
    db.rows('ingredient').push({ id: 'ingredient-a-basil', family_id: 'family-A', name: 'Basil', unit: null })
    db.rows('recipeIngredient').push({ id: 'ri-a-basil', recipe_id: 'recipe-a', ingredient_id: 'ingredient-a-basil', amount: 1, unit: null, note: null })
    const res = await cook.GET(req({ as: 'childA' }))
    expect(res.status).toBe(200)
    const body = await expectNoForeignData(res)
    expect(body.recipesConsidered).toBe(1)
    expect(body.suggestions).toHaveLength(1)
    expect(body.suggestions[0]).toMatchObject({
      recipeId: 'recipe-a',
      title: 'Home lasagne',
      haveCount: 1,
      missingCount: 1,
      coverage: 0.5,
      useSoonCount: 1,
      have: [{ ingredientId: 'ingredient-a', name: 'Home Tomato' }],
      missing: [{ ingredientId: 'ingredient-a-basil', name: 'Basil' }],
    })
    // Family B has the same shape; it sees only its own recipe.
    const other = await (await cook.GET(req({ as: 'parentB' }))).json()
    expect(other.suggestions.map((s: any) => s.recipeId)).toEqual(['recipe-b'])
    expect((await cook.GET(req({ as: 'childA', query: { limit: '0' } }))).status).toBe(400)
  })

  it('an unlinked item matches a recipe ingredient by normalized name', async () => {
    db.find('inventoryItem', 'inv-a')!.ingredient_id = null
    db.find('inventoryItem', 'inv-a')!.name = '  home   tomato '
    const body = await (await cook.GET(req({ as: 'parentA' }))).json()
    expect(body.suggestions[0]).toMatchObject({ recipeId: 'recipe-a', haveCount: 1, missingCount: 0 })
  })

  it('every handler is gated by the inventory feature; cook also needs meals', async () => {
    mockGate.mockImplementation(async () => nextServerMock.NextResponse.json({ error: 'off' }, { status: 403 }))
    const statuses = [
      (await list('parentA')).status,
      (await create('parentA', { name: 'x' })).status,
      (await item.GET(req({ as: 'parentA' }), P('inv-a'))).status,
      (await patch('parentA', 'inv-a', { name: 'x' })).status,
      (await remove('parentA', 'inv-a')).status,
      (await useSoon.GET(req({ as: 'parentA' }))).status,
      (await cook.GET(req({ as: 'parentA' }))).status,
    ]
    expect(new Set(statuses)).toEqual(new Set([403]))
    expect(new Set(mockGate.mock.calls.map((c) => c[1]))).toEqual(new Set(['inventory']))
    expect(new Set(mockGate.mock.calls.map((c) => c[0]))).toEqual(new Set(['family-A']))
    expect(db.writes).toHaveLength(0)

    mockGate.mockImplementation(async (_f: string, key: string) =>
      key === 'meals' ? nextServerMock.NextResponse.json({ error: 'off' }, { status: 403 }) : null
    )
    expect((await cook.GET(req({ as: 'parentA' }))).status).toBe(403)
    expect((await list('parentA')).status).toBe(200)
  })
})
