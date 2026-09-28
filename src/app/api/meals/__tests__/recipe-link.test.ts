// /api/meals recipe link (ADR-0007, #251): optional recipe_id + servings,
// household validation, old-shape compatibility and O-1 (several meals per slot).

jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('next/headers', () => require('@/__tests__/helpers/two-household').nextHeadersMock)
jest.mock('@/lib/session', () => require('@/__tests__/helpers/two-household').sessionMock)
jest.mock('@/lib/prisma', () => ({ prisma: require('@/__tests__/helpers/two-household').fakePrisma }))
const mockGate = jest.fn(async (_familyId: string, _key: string): Promise<unknown> => null)
jest.mock('@/lib/feature-gate-server', () => ({
  featureGate: (familyId: string, key: string) => mockGate(familyId, key),
}))

import * as meals from '../route'
import * as meal from '../[id]/route'
import { db, req, writesTo, expectNoForeignData, nextServerMock } from '@/__tests__/helpers/two-household'

const today = new Date().toISOString().slice(0, 10)

describe('meals — recipe link', () => {
  beforeEach(() => {
    db.reset()
    mockGate.mockReset()
    mockGate.mockImplementation(async () => null)
  })

  it('old-shape requests (no recipe_id/servings) behave as before', async () => {
    // The exact bodies /dashboard/meals sent before ADR-0007.
    const created = await meals.POST(
      req({ as: 'parentA', body: { date: today, meal_type: 'lunch', recipe_name: 'Soup', notes: 'hot', cook_id: 'teen-a' } })
    )
    expect(created.status).toBe(201)
    const { meal: m } = await created.json()
    expect(m).toMatchObject({
      family_id: 'family-A',
      meal_type: 'lunch',
      recipe_name: 'Soup',
      notes: 'hot',
      cook_id: 'teen-a',
      recipe_id: null,
      servings: null,
      recipe: null,
      cook: { id: 'teen-a', name: 'Teen A' },
      creator: { id: 'parent-a', name: 'Parent A' },
    })
    const blank = await meals.POST(req({ as: 'childA', body: { date: today, meal_type: 'snack' } }))
    expect(blank.status).toBe(201)
    expect((await blank.json()).meal.recipe_name).toBe('')

    const patched = await meal.PATCH(req({ as: 'parentA', body: { id: 'meal-a', recipe_name: 'Pizza', notes: null } }))
    expect(patched.status).toBe(200)
    const body = await patched.json()
    expect(body.meal).toMatchObject({ id: 'meal-a', recipe_name: 'Pizza', notes: null, recipe_id: null })
    expect(writesTo('familyMeal')[2].args.data).toEqual({ recipe_name: 'Pizza', notes: null })
  })

  it('links a same-family recipe and snapshots its title when recipe_name is omitted', async () => {
    const res = await meals.POST(req({ as: 'childA', body: { date: today, meal_type: 'dinner', recipe_id: 'recipe-a', servings: 6 } }))
    expect(res.status).toBe(201)
    const body = await expectNoForeignData(res)
    expect(body.meal).toMatchObject({
      recipe_id: 'recipe-a',
      recipe_name: 'Home lasagne',
      servings: 6,
      recipe: { id: 'recipe-a', title: 'Home lasagne', prep_time: 20, cook_time: 45, servings: 4 },
    })
    // The summary never carries the recipe body.
    expect(body.meal.recipe).not.toHaveProperty('instructions')
    expect(body.meal.recipe).not.toHaveProperty('description')

    const named = await meals.POST(req({ as: 'childA', body: { date: today, meal_type: 'dinner', recipe_id: 'recipe-a', recipe_name: 'Nonna’s' } }))
    expect((await named.json()).meal.recipe_name).toBe('Nonna’s')
  })

  it('refuses a foreign recipe_id with the same 400 as a missing one (POST and PATCH), writing nothing', async () => {
    const base = { date: today, meal_type: 'dinner' }
    const foreign = await meals.POST(req({ as: 'parentA', body: { ...base, recipe_id: 'recipe-b' } }))
    const missing = await meals.POST(req({ as: 'parentA', body: { ...base, recipe_id: 'recipe-zzz' } }))
    expect(foreign.status).toBe(400)
    await expectNoForeignData(foreign)
    expect(await foreign.json()).toEqual(await missing.json())

    const patched = await meal.PATCH(req({ as: 'parentA', body: { id: 'meal-a', recipe_id: 'recipe-b' } }))
    expect(patched.status).toBe(400)
    await expectNoForeignData(patched)
    expect(db.writes).toHaveLength(0)
    expect(db.find('familyMeal', 'meal-a')!.recipe_id).toBeNull()
  })

  it('PATCH links, renames from the recipe, and unlinks without losing the snapshot', async () => {
    const linked = await meal.PATCH(req({ as: 'teenA', body: { id: 'meal-a', recipe_id: 'recipe-a', servings: 3 } }))
    expect(linked.status).toBe(200)
    expect((await linked.json()).meal).toMatchObject({ recipe_id: 'recipe-a', recipe_name: 'Home lasagne', servings: 3 })

    const unlinked = await meal.PATCH(req({ as: 'teenA', body: { id: 'meal-a', recipe_id: null, servings: null } }))
    expect((await unlinked.json()).meal).toMatchObject({ recipe_id: null, recipe_name: 'Home lasagne', servings: null, recipe: null })
  })

  it('validates servings', async () => {
    for (const servings of [0, 101, 2.5, '4']) {
      const res = await meals.POST(req({ as: 'parentA', body: { date: today, meal_type: 'dinner', servings } }))
      expect(res.status).toBe(400)
    }
    expect(db.writes).toHaveLength(0)
  })

  it('allows more than one meal in the same slot (O-1) and GET returns all of them with recipe summaries', async () => {
    const slot = { date: today, meal_type: 'dinner' }
    expect((await meals.POST(req({ as: 'parentA', body: { ...slot, recipe_name: 'Tacos' } }))).status).toBe(201)
    expect((await meals.POST(req({ as: 'teenA', body: { ...slot, recipe_id: 'recipe-a' } }))).status).toBe(201)

    const res = await meals.GET(req({ as: 'childA' }))
    const body = await expectNoForeignData(res)
    const inSlot = body.meals.filter((m: any) => m.meal_type === 'dinner' && m.date.toISOString().startsWith(today))
    expect(inSlot.map((m: any) => m.recipe_name).sort()).toEqual(['Home lasagne', 'Tacos'])
    expect(inSlot.find((m: any) => m.recipe_id === 'recipe-a').recipe).toEqual({
      id: 'recipe-a',
      title: 'Home lasagne',
      prep_time: 20,
      cook_time: 45,
      servings: 4,
    })
  })

  it('stays gated by the meals feature', async () => {
    mockGate.mockImplementation(async () => nextServerMock.NextResponse.json({ error: 'off' }, { status: 403 }))
    expect((await meals.POST(req({ as: 'parentA', body: { date: today, meal_type: 'dinner', recipe_id: 'recipe-a' } }))).status).toBe(403)
    expect((await meal.PATCH(req({ as: 'parentA', body: { id: 'meal-a', recipe_id: 'recipe-a' } }))).status).toBe(403)
    expect(mockGate.mock.calls.every((c) => c[1] === 'meals')).toBe(true)
    expect(db.writes).toHaveLength(0)
  })
})
