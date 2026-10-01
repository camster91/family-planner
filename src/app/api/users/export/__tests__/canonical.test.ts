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
    // #158 fields (defaults for a row written before them).
    expect(body.inventory[0]).toMatchObject({ date_kind: 'best_before', status: 'active' })
  })

  it.each(['parentA', 'childA'] as const)('%s export includes the household inventory history (#158), never another household', async (who) => {
    for (const [f, family_id] of [
      ['a', FAMILY_A],
      ['b', FAMILY_B],
    ] as const) {
      db.rows('inventoryAdjustment').push({
        id: `adj-${f}`, family_id, item_id: `inv-${f}`, kind: 'discard', amount_delta: -3, amount_before: 3, amount_after: 3,
        status_before: 'active', status_after: 'discarded', actor_id: `parent-${f}`, request_id: `req-${f}`,
        item_version: T, created_at: T, undone_at: null, undone_by: null,
      })
    }
    const { body } = await exportAs(who)
    expect(body.inventoryAdjustments.map((a: any) => a.id)).toEqual(['adj-a'])
    expect(body.inventoryAdjustments[0]).toMatchObject({ item_id: 'inv-a', kind: 'discard', amount_delta: -3, actor_id: 'parent-a' })
    expect(body.inventoryAdjustments[0]).not.toHaveProperty('family_id')
    expect(body.inventoryAdjustments[0]).not.toHaveProperty('request_id')
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

  it.each(['parentA', 'childA'] as const)("%s export includes their own notification preferences (#286), nobody else's", async (who) => {
    const self = who === 'parentA' ? 'parent-a' : 'child-a'
    const other = who === 'parentA' ? 'child-a' : 'parent-a'
    db.find('user', self)!.notify_events = false
    db.find('user', other)!.notify_chores = false
    db.find('user', 'parent-b')!.notify_messages = false
    const { body } = await exportAs(who)
    expect(body.notificationPreferences).toEqual({ chores: true, events: false, messages: true })
    expect(body.user).toMatchObject({ notify_chores: true, notify_events: false, notify_messages: true })
  })

  it("export includes the caller's own quiet hours (#141, O-32), nobody else's", async () => {
    Object.assign(db.find('user', 'child-a')!, {
      quiet_hours_enabled: true,
      quiet_hours_start: '21:00',
      quiet_hours_end: '06:30',
      quiet_hours_time_zone: 'America/Toronto',
    })
    const child = await exportAs('childA')
    expect(child.body.quietHours).toEqual({ enabled: true, start: '21:00', end: '06:30', timeZone: 'America/Toronto' })
    const parent = await exportAs('parentA')
    expect(parent.body.quietHours).toEqual({ enabled: false, start: '22:00', end: '07:00', timeZone: null })
  })

  it('import job listings stay parent-only; backfill archives are the only job data a child gets', async () => {
    const child = await exportAs('childA')
    expect(child.body.importJobs).toEqual([])
    const parent = await exportAs('parentA')
    expect(parent.body.importJobs.map((j: any) => j.id).sort()).toEqual(['backfill-a', 'job-a'])
  })

  it('household audit history (#285): every recent row for a parent, only their own for a child, none past 12 months', async () => {
    const recent = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const old = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000)
    const row = (id: string, family_id: string, actor: string, at: Date, summary: string) => ({
      id, family_id, actor_user_id: actor, actor_kind: 'person', action: 'feature.turned_on',
      target_type: 'feature', target_id: 'wishlist', summary, created_at: at,
    })
    db.rows('auditLog').push(
      row('al-parent', FAMILY_A, 'parent-a', recent, 'Turned on Wishlist'),
      row('al-child', FAMILY_A, 'child-a', recent, 'Child A joined as a child'),
      row('al-old', FAMILY_A, 'parent-a', old, 'Turned off Wishlist'),
      row('al-b', FAMILY_B, 'parent-b', recent, `${FOREIGN} change`)
    )
    const parent = await exportAs('parentA')
    expect(parent.body.auditLog.map((r: any) => r.id).sort()).toEqual(['al-child', 'al-parent'])
    expect(parent.body.auditLog[0]).not.toHaveProperty('family_id')
    const child = await exportAs('childA')
    expect(child.body.auditLog.map((r: any) => r.id)).toEqual(['al-child'])
  })

  it.each(['parentA', 'childA'] as const)(
    "beta usage counts (#287): %s gets the household's switch and counts, no family_id, never household B's",
    async (who) => {
      db.rows('family').find((f) => f.id === FAMILY_A)!.beta_metrics_enabled = true
      const day = new Date('2026-09-28T00:00:00Z')
      db.rows('betaMetricDaily').push(
        { family_id: FAMILY_A, day, metric: 'chore_completed', count: 4 },
        { family_id: FAMILY_B, day, metric: 'reward_claimed', count: 9 }
      )
      const { body } = await exportAs(who)
      expect(body.family.beta_metrics_enabled).toBe(true)
      expect(body.betaMetrics).toEqual([{ day: day.toISOString(), metric: 'chore_completed', count: 4 }])
    }
  )

  it.each(['parentA', 'childA'] as const)('%s export never contains another household', async (who) => {
    const { raw } = await exportAs(who)
    expect(raw).not.toContain(FOREIGN)
    expect(raw).not.toContain('meal-b')
    expect(raw).not.toContain('backfill-b')
    expect(raw).not.toContain('inv-b')
  })
})
