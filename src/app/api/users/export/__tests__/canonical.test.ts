// GET /api/users/export on the two-household harness (ADR-0007, #251): the
// export carries the household's FamilyMeal rows and the backfill job
// summaries that archive skipped legacy rows, keeps the legacy tables, and
// never includes another household's data.

jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('next/headers', () => require('@/__tests__/helpers/two-household').nextHeadersMock)
jest.mock('@/lib/session', () => require('@/__tests__/helpers/two-household').sessionMock)
jest.mock('@/lib/prisma', () => ({ prisma: require('@/__tests__/helpers/two-household').fakePrisma }))

import { GET } from '../route'
import { db, req, FAMILY_A, FAMILY_B, FOREIGN } from '@/__tests__/helpers/two-household'
import { BACKFILL_SOURCE_APP } from '@/lib/backfill/meals-groceries'

const T = new Date('2026-09-20T00:00:00Z')

function seedLegacyAndBackfill() {
  for (const [f, family_id, tag] of [
    ['a', FAMILY_A, 'Home'],
    ['b', FAMILY_B, FOREIGN],
  ] as const) {
    db.rows('mealPlan').push({ id: `mp-${f}`, family_id, name: `${tag} week`, start_date: T, end_date: T, created_by: `parent-${f}`, created_at: T })
    db.rows('mealPlanEntry').push({ id: `mpe-${f}`, meal_plan_id: `mp-${f}`, recipe_id: `recipe-${f}`, date: T, meal_type: 'dinner', servings: 2 })
    db.rows('shoppingList').push({ id: `sl-${f}`, family_id, name: `${tag} shop`, created_by: `parent-${f}`, created_at: T, updated_at: T })
    db.rows('shoppingItem').push({ id: `si-${f}`, shopping_list_id: `sl-${f}`, ingredient_name: `${tag} flour`, checked: false })
    db.rows('importJob').push({
      id: `backfill-${f}`, family_id, source_app: BACKFILL_SOURCE_APP, source_version: 'adr-0007-backfill-v1',
      status: 'completed', dry_run: false, started_by: `parent-${f}`, started_at: T, completed_at: T,
      summary: { skipped: [{ model: 'MealPlanEntry', id: `mpe-x-${f}`, reason: 'unknown_meal_type', row: { meal_type: `${tag} brunch` } }] },
      error: null,
    })
  }
  db.find('familyMeal', 'meal-a')!.recipe_id = 'recipe-a'
  db.find('familyMeal', 'meal-a')!.servings = 4
}

async function exportAs(who: 'parentA' | 'childA') {
  const res = await GET(req({ as: who }))
  expect(res.status).toBe(200)
  const raw = await res.text()
  return { raw, body: JSON.parse(raw) }
}

describe('GET /api/users/export — canonical meal data', () => {
  beforeEach(() => {
    db.reset()
    seedLegacyAndBackfill()
  })

  it.each(['parentA', 'childA'] as const)('%s export includes the household FamilyMeal rows', async (who) => {
    const { body } = await exportAs(who)
    expect(body.meals).toHaveLength(1)
    expect(body.meals[0]).toMatchObject({
      id: 'meal-a',
      meal_type: 'dinner',
      recipe_name: 'Home pasta',
      recipe_id: 'recipe-a',
      servings: 4,
      cook_id: 'parent-a',
      created_by: 'parent-a',
    })
    expect(body.meals[0]).not.toHaveProperty('family_id')
  })

  it.each(['parentA', 'childA'] as const)('%s export keeps recipes and the legacy tables, and adds backfill archives', async (who) => {
    const { body } = await exportAs(who)
    expect(body.recipes.map((r: any) => r.id)).toEqual(['recipe-a'])
    expect(body.recipes[0].ingredients[0].ingredient.name).toBe('Home Tomato')
    expect(body.mealPlans.map((p: any) => p.id)).toEqual(['mp-a'])
    expect(body.mealPlans[0].entries.map((e: any) => e.id)).toEqual(['mpe-a'])
    expect(body.shoppingLists.map((l: any) => l.id)).toEqual(['sl-a'])
    expect(body.shoppingLists[0].items.map((i: any) => i.id)).toEqual(['si-a'])
    expect(body.mealBackfillJobs.map((j: any) => j.id)).toEqual(['backfill-a'])
    expect(body.mealBackfillJobs[0].summary.skipped[0].row.meal_type).toBe('Home brunch')
  })

  it.each(['parentA', 'childA'] as const)('%s export includes the household food inventory (#263)', async (who) => {
    const { body } = await exportAs(who)
    expect(body.inventory).toHaveLength(1)
    expect(body.inventory[0]).toMatchObject({
      id: 'inv-a',
      name: 'Home Tomato',
      ingredient_id: 'ingredient-a',
      amount: 3,
      location: 'fridge',
      added_by: 'parent-a',
    })
    expect(body.inventory[0]).not.toHaveProperty('family_id')
  })

  it.each(['parentA', 'childA'] as const)('%s export includes the household grocery sections and trips (#273)', async (who) => {
    for (const [f, family_id, tag] of [
      ['a', FAMILY_A, 'home'],
      ['b', FAMILY_B, FOREIGN.toLowerCase()],
    ] as const) {
      db.rows('grocerySectionPreference').push({
        id: `gsp-${f}`, family_id, name_key: `${tag} milk`, section: 'household', updated_by: `parent-${f}`, created_at: T, updated_at: T,
      })
      db.rows('groceryShoppingSession').push({
        id: `trip-${f}`, family_id, list_id: `list-${f}`, sections: ['produce', 'dairy_eggs'], started_at: T, last_tick_at: T,
      })
    }
    const { body, raw } = await exportAs(who)
    expect(body.grocerySectionPreferences).toEqual([
      { name_key: 'home milk', section: 'household', updated_by: 'parent-a', created_at: T.toISOString(), updated_at: T.toISOString() },
    ])
    expect(body.groceryShoppingSessions).toEqual([
      { id: 'trip-a', list_id: 'list-a', sections: ['produce', 'dairy_eggs'], started_at: T.toISOString(), last_tick_at: T.toISOString() },
    ])
    expect(raw.toLowerCase()).not.toContain('foreign milk')
    expect(raw).not.toContain('trip-b')
  })

  it('import job listings stay parent-only; backfill archives are the only job data a child gets', async () => {
    const child = await exportAs('childA')
    expect(child.body.importJobs).toEqual([])
    const parent = await exportAs('parentA')
    expect(parent.body.importJobs.map((j: any) => j.id).sort()).toEqual(['backfill-a', 'job-a'])
  })

  it.each(['parentA', 'childA'] as const)('%s export never contains another household', async (who) => {
    const { raw } = await exportAs(who)
    expect(raw).not.toContain(FOREIGN)
    expect(raw).not.toContain('meal-b')
    expect(raw).not.toContain('backfill-b')
    expect(raw).not.toContain('inv-b')
  })
})
