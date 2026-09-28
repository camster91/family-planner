// /api/recipes and /api/recipes/[id] (ADR-0007, #251): two households, roles
// (O-7) and the `meals` feature gate.

jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('next/headers', () => require('@/__tests__/helpers/two-household').nextHeadersMock)
jest.mock('@/lib/session', () => require('@/__tests__/helpers/two-household').sessionMock)
jest.mock('@/lib/prisma', () => ({ prisma: require('@/__tests__/helpers/two-household').fakePrisma }))
const mockGate = jest.fn(async (_familyId: string, _key: string): Promise<unknown> => null)
jest.mock('@/lib/feature-gate-server', () => ({
  featureGate: (familyId: string, key: string) => mockGate(familyId, key),
}))

import * as recipes from '../route'
import * as recipe from '../[id]/route'
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

const P = (id: string) => params({ id })

function create(as: UserKey | null, body: unknown) {
  return recipes.POST(req({ as, method: 'POST', body }))
}
function patch(as: UserKey | null, id: string, body: unknown) {
  return recipe.PATCH(req({ as, method: 'PATCH', body }), P(id))
}

describe('recipes — two households, roles and gate', () => {
  beforeEach(() => {
    db.reset()
    mockGate.mockReset()
    mockGate.mockImplementation(async () => null)
  })

  it('returns 401 to an unauthenticated caller on every handler', async () => {
    const statuses = [
      (await recipes.GET(req())).status,
      (await create(null, { title: 'x' })).status,
      (await recipe.GET(req(), P('recipe-a'))).status,
      (await patch(null, 'recipe-a', { title: 'x' })).status,
      (await recipe.DELETE(req({ method: 'DELETE' }), P('recipe-a'))).status,
    ]
    expect(new Set(statuses)).toEqual(new Set([401]))
    expect(db.writes).toHaveLength(0)
  })

  it('lists only the caller household, for every role', async () => {
    for (const who of ['parentA', 'teenA', 'childA'] as UserKey[]) {
      const res = await recipes.GET(req({ as: who }))
      expect(res.status).toBe(200)
      const body = await expectNoForeignData(res)
      expect(body.recipes.map((r: any) => r.id)).toEqual(['recipe-a'])
      expect(body.recipes[0]._count).toEqual({ ingredients: 1 })
      expect(body.nextOffset).toBeNull()
    }
  })

  it('paginates with limit/offset and validates them', async () => {
    db.rows('recipe').push({ ...db.find('recipe', 'recipe-a')!, id: 'recipe-a2', title: 'Home omelette' })
    const first = await (await recipes.GET(req({ as: 'childA', query: { limit: '1' } }))).json()
    expect(first.recipes.map((r: any) => r.id)).toEqual(['recipe-a'])
    expect(first.nextOffset).toBe(1)
    const second = await (await recipes.GET(req({ as: 'childA', query: { limit: '1', offset: '1' } }))).json()
    expect(second.recipes.map((r: any) => r.id)).toEqual(['recipe-a2'])
    expect(second.nextOffset).toBeNull()
    expect((await recipes.GET(req({ as: 'childA', query: { limit: '0' } }))).status).toBe(400)
    expect((await recipes.GET(req({ as: 'childA', query: { limit: '500' } }))).status).toBe(400)
  })

  it('reads a same-family recipe with nested ingredients (child allowed)', async () => {
    const res = await recipe.GET(req({ as: 'childA' }), P('recipe-a'))
    expect(res.status).toBe(200)
    const body = await expectNoForeignData(res)
    expect(body.recipe).toMatchObject({ id: 'recipe-a', title: 'Home lasagne', servings: 4 })
    expect(body.recipe.ingredients).toEqual([
      { id: 'ri-a', amount: 400, unit: 'g', note: null, ingredient: { id: 'ingredient-a', name: 'Home Tomato', unit: 'g' } },
    ])
  })

  it('answers a cross-family read exactly like a missing id (no existence leak)', async () => {
    const foreign = await recipe.GET(req({ as: 'parentA' }), P('recipe-b'))
    const missing = await recipe.GET(req({ as: 'parentA' }), P('recipe-nope'))
    expect(foreign.status).toBe(404)
    await expectDenied(foreign, [404])
    expect(await foreign.json()).toEqual(await missing.json())
  })

  it('a teen creates a recipe; named ingredients are upserted by normalized name in the household', async () => {
    const res = await create('teenA', {
      title: '  Tomato soup ',
      prep_time: 10,
      servings: 2,
      ingredients: [
        { name: '  home   TOMATO ', amount: 500, unit: 'g' },
        { name: 'Basil', amount: 1, unit: 'bunch', note: 'fresh' },
      ],
    })
    expect(res.status).toBe(201)
    const body = await expectNoForeignData(res)
    expect(body.recipe).toMatchObject({ title: 'Tomato soup', prep_time: 10, servings: 2, created_by: 'teen-a' })
    const created = db.find('recipe', body.recipe.id)!
    expect(created.family_id).toBe('family-A')
    // The existing family-A ingredient is reused; only Basil is new, and in family A.
    const names = body.recipe.ingredients.map((i: any) => i.ingredient.name).sort()
    expect(names).toEqual(['Basil', 'Home Tomato'])
    const basil = db.rows('ingredient').find((i) => i.name === 'Basil')!
    expect(basil.family_id).toBe('family-A')
    expect(db.rows('ingredient').filter((i) => i.family_id === 'family-A')).toHaveLength(2)
    // The family-B ingredient is untouched and never matched.
    expect(db.find('ingredient', 'ingredient-b')!.name).toBe('FOREIGN Tomato')
  })

  it('never matches another household ingredient by name', async () => {
    const res = await create('parentA', { title: 'Sauce', ingredients: [{ name: 'FOREIGN tomato', amount: 1 }] })
    expect(res.status).toBe(201)
    const body = await res.json()
    const used = body.recipe.ingredients[0].ingredient.id
    expect(used).not.toBe('ingredient-b')
    expect(db.find('ingredient', used)!.family_id).toBe('family-A')
  })

  it('refuses a foreign ingredient_id with the same 400 as a missing one, writing nothing', async () => {
    const foreign = await create('parentA', { title: 'x', ingredients: [{ ingredient_id: 'ingredient-b', amount: 1 }] })
    const missing = await create('parentA', { title: 'x', ingredients: [{ ingredient_id: 'ingredient-zzz', amount: 1 }] })
    expect(foreign.status).toBe(400)
    await expectNoForeignData(foreign)
    expect(await foreign.json()).toEqual(await missing.json())
    expect(writesTo('recipe')).toHaveLength(0)
    expect(writesTo('recipeIngredient')).toHaveLength(0)
  })

  it('accepts a same-family ingredient_id and rejects duplicates and unknown fields', async () => {
    const ok = await create('parentA', { title: 'Bruschetta', ingredients: [{ ingredient_id: 'ingredient-a', amount: 2 }] })
    expect(ok.status).toBe(201)
    const dup = await create('parentA', {
      title: 'x',
      ingredients: [
        { ingredient_id: 'ingredient-a', amount: 2 },
        { name: 'home tomato', amount: 1 },
      ],
    })
    expect(dup.status).toBe(400)
    // A body cannot choose the household or the author.
    expect((await create('parentA', { title: 'x', family_id: 'family-B' })).status).toBe(400)
    expect((await create('parentA', { title: 'x', created_by: 'parent-b' })).status).toBe(400)
    expect((await create('parentA', { title: '' })).status).toBe(400)
    expect((await create('parentA', { title: 'x', ingredients: [{ amount: 1 }] })).status).toBe(400)
  })

  it('a child may read but not create, edit or delete (O-7)', async () => {
    expect((await create('childA', { title: 'x' })).status).toBe(403)
    expect((await patch('childA', 'recipe-a', { title: 'x' })).status).toBe(403)
    expect((await recipe.DELETE(req({ as: 'childA', method: 'DELETE' }), P('recipe-a'))).status).toBe(403)
    expect((await recipe.DELETE(req({ as: 'teenA', method: 'DELETE' }), P('recipe-a'))).status).toBe(403)
    expect(db.writes).toHaveLength(0)
  })

  it('refuses to update or delete another household recipe (404, no writes)', async () => {
    await expectDenied(await patch('parentA', 'recipe-b', { title: 'mine now' }), [404])
    await expectDenied(await recipe.DELETE(req({ as: 'parentA', method: 'DELETE' }), P('recipe-b')), [404])
    expect(db.writes).toHaveLength(0)
    expect(db.find('recipe', 'recipe-b')!.title).toBe('FOREIGN lasagne')
  })

  it('refuses a foreign ingredient id in a PATCH body and leaves the recipe unchanged', async () => {
    const res = await patch('teenA', 'recipe-a', { ingredients: [{ ingredient_id: 'ingredient-b', amount: 3 }] })
    expect(res.status).toBe(400)
    await expectNoForeignData(res)
    expect(db.rows('recipeIngredient').filter((r) => r.recipe_id === 'recipe-a')).toHaveLength(1)
  })

  it('PATCH updates fields and replaces the ingredient set', async () => {
    const res = await patch('teenA', 'recipe-a', {
      title: 'Veggie lasagne',
      cook_time: null,
      ingredients: [{ name: 'Spinach', amount: 200, unit: 'g' }],
    })
    expect(res.status).toBe(200)
    const body = await expectNoForeignData(res)
    expect(body.recipe).toMatchObject({ id: 'recipe-a', title: 'Veggie lasagne', cook_time: null })
    expect(body.recipe.ingredients.map((i: any) => i.ingredient.name)).toEqual(['Spinach'])
    expect(db.rows('recipeIngredient').filter((r) => r.recipe_id === 'recipe-b')).toHaveLength(1)
  })

  it('a parent deletes a same-family recipe; one in an archived legacy plan is refused', async () => {
    db.rows('mealPlanEntry').push({ id: 'mpe-a', meal_plan_id: 'mp-a', recipe_id: 'recipe-a', date: new Date(), meal_type: 'dinner', servings: 2 })
    const blocked = await recipe.DELETE(req({ as: 'parentA', method: 'DELETE' }), P('recipe-a'))
    expect(blocked.status).toBe(409)
    expect((await blocked.json()).error.code).toBe('RECIPE_IN_ARCHIVED_PLAN')
    expect(db.find('recipe', 'recipe-a')).toBeDefined()

    db.tables.mealPlanEntry = []
    const res = await recipe.DELETE(req({ as: 'parentA', method: 'DELETE' }), P('recipe-a'))
    expect(res.status).toBe(200)
    expect(db.find('recipe', 'recipe-a')).toBeUndefined()
    expect(db.find('recipe', 'recipe-b')).toBeDefined()
  })

  it('every handler is gated by the meals feature', async () => {
    mockGate.mockImplementation(async () => nextServerMock.NextResponse.json({ error: 'off' }, { status: 403 }))
    const statuses = [
      (await recipes.GET(req({ as: 'parentA' }))).status,
      (await create('parentA', { title: 'x' })).status,
      (await recipe.GET(req({ as: 'parentA' }), P('recipe-a'))).status,
      (await patch('parentA', 'recipe-a', { title: 'x' })).status,
      (await recipe.DELETE(req({ as: 'parentA', method: 'DELETE' }), P('recipe-a'))).status,
    ]
    expect(new Set(statuses)).toEqual(new Set([403]))
    expect(new Set(mockGate.mock.calls.map((c) => c[1]))).toEqual(new Set(['meals']))
    expect(new Set(mockGate.mock.calls.map((c) => c[0]))).toEqual(new Set(['family-A']))
    expect(db.writes).toHaveLength(0)
  })
})
