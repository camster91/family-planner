import { buildFixtureDataset, evaluateFixtureTarget, FIXTURE_IDS, FIXTURE_LEGACY_MEAL_IDS } from '@/lib/fixtures'
import type { FixtureDataset } from '@/lib/fixtures'
import {
  BackfillUsageError,
  classifyRecipeRef,
  cleanContent,
  evaluateBackfillTarget,
  matchIngredient,
  mealNamesMatch,
  normalizeMealType,
  normalizeName,
  parseBackfillArgs,
  planFamilyBackfill,
  planHasWork,
  reconcile,
  utcMidnightLiteral,
} from '../meals-groceries'
import type { FamilySource } from '../meals-groceries'

const L = FIXTURE_LEGACY_MEAL_IDS
const day = (d: unknown) => (d as Date).toISOString().slice(0, 10)

/** The in-memory equivalent of loadFamilySource() over the fixture dataset. */
function sourceFromDataset(ds: FixtureDataset, familyId: string, mappings: FamilySource['mappings'] = {}): FamilySource {
  const recipeFamily = new Map(ds.recipes.map((r) => [r.id, r]))
  const plans = ds.mealPlans.filter((p) => p.family_id === familyId)
  const planIds = new Set(plans.map((p) => p.id))
  const lists = ds.shoppingLists.filter((s) => s.family_id === familyId)
  const listIds = new Set(lists.map((s) => s.id))
  return {
    familyId,
    mealPlans: plans.map((p) => ({ id: p.id, raw: { ...p } })),
    entries: ds.mealPlanEntries
      .filter((e) => planIds.has(e.meal_plan_id))
      .map((e) => {
        const r = recipeFamily.get(e.recipe_id)
        return {
          id: e.id,
          mealPlanId: e.meal_plan_id,
          day: day(e.date),
          mealType: e.meal_type,
          servings: e.servings ?? null,
          recipeId: e.recipe_id,
          recipeFamilyId: r?.family_id ?? null,
          recipeTitle: r && r.family_id === familyId ? r.title : null,
          createdBy: plans.find((p) => p.id === e.meal_plan_id)!.created_by,
          raw: { ...e },
        }
      }),
    meals: ds.familyMeals
      .filter((m) => m.family_id === familyId)
      .map((m) => ({ id: m.id, day: day(m.date), mealType: m.meal_type, recipeName: m.recipe_name ?? null, recipeId: m.recipe_id ?? null })),
    shoppingLists: lists.map((s) => ({ id: s.id, name: s.name!, createdBy: s.created_by, createdAt: '2025-11-10T00:00:00.000', raw: { ...s } })),
    shoppingItems: ds.shoppingItems
      .filter((i) => listIds.has(i.shopping_list_id))
      .map((i) => ({
        id: i.id,
        shoppingListId: i.shopping_list_id,
        name: i.ingredient_name,
        amount: i.amount ?? null,
        unit: i.unit ?? null,
        category: i.category ?? null,
        checked: Boolean(i.checked),
        recipeId: i.recipe_id ?? null,
        recipeFamilyId: i.recipe_id ? (recipeFamily.get(i.recipe_id)?.family_id ?? null) : null,
        raw: { ...i },
      })),
    ingredients: ds.ingredients.filter((g) => g.family_id === familyId).map((g) => ({ id: g.id, name: g.name })),
    mappings,
    existingListIds: [],
  }
}

function idGen() {
  let n = 0
  return () => `new_${++n}`
}

describe('normalisation helpers', () => {
  it('normalizes meal types without coercing unknown values', () => {
    expect(normalizeMealType(' Dinner ')).toBe('dinner')
    expect(normalizeMealType('LUNCH')).toBe('lunch')
    expect(normalizeMealType('snack')).toBe('snack')
    expect(normalizeMealType('Brunch')).toBeNull()
    expect(normalizeMealType('')).toBeNull()
    expect(normalizeMealType(null)).toBeNull()
  })

  it('normalizes names for comparison and trims content', () => {
    expect(normalizeName('  Veggie   LASAGNA ')).toBe('veggie lasagna')
    expect(normalizeName('Café')).toBe(normalizeName('Café'))
    expect(mealNamesMatch('  veggie Lasagna ', 'Veggie lasagna')).toBe(true)
    expect(mealNamesMatch('Takeout pizza', 'Tomato soup')).toBe(false)
    expect(mealNamesMatch(null, null)).toBe(false)
    expect(mealNamesMatch('', '  ')).toBe(false)
    expect(cleanContent('  tomatoes ')).toBe('tomatoes')
    expect(cleanContent('   ')).toBe('')
    expect(cleanContent(null)).toBe('')
  })

  it('builds the UTC-midnight literal for date-only values', () => {
    expect(utcMidnightLiteral('2025-11-10')).toBe('2025-11-10T00:00:00.000')
    expect(() => utcMidnightLiteral('2025-11-10T12:00:00Z')).toThrow(/date-only/)
  })

  it('keeps only same-household recipe references', () => {
    expect(classifyRecipeRef(null, null, 'fam')).toEqual({ recipeId: null, issue: null })
    expect(classifyRecipeRef('r1', 'fam', 'fam')).toEqual({ recipeId: 'r1', issue: null })
    expect(classifyRecipeRef('r1', 'other', 'fam')).toEqual({ recipeId: null, issue: 'foreign_recipe' })
    expect(classifyRecipeRef('r1', null, 'fam')).toEqual({ recipeId: null, issue: 'missing_recipe' })
  })

  it('matches an ingredient only when exactly one normalises equal', () => {
    const ings = [
      { id: 'i1', name: 'Tomatoes' },
      { id: 'i2', name: 'Tofu' },
      { id: 'i3', name: 'tofu ' },
    ]
    expect(matchIngredient(' tomatoes', ings)).toBe('i1')
    expect(matchIngredient('Tofu', ings)).toBeNull() // ambiguous
    expect(matchIngredient('Paper towels', ings)).toBeNull()
    expect(matchIngredient('', ings)).toBeNull()
  })
})

describe('target guard', () => {
  const run = (env: Record<string, string | undefined>, approvalFlag = false) =>
    evaluateBackfillTarget(env, { approvalFlag }, evaluateFixtureTarget)

  it('allows loopback and disposable docker targets without extra flags', () => {
    expect(run({ DATABASE_URL: 'postgresql://postgres@localhost:5432/fp_250_x' }).allowed).toBe(true)
    expect(run({ DATABASE_URL: 'postgresql://postgres@127.0.0.1/fp' }).allowed).toBe(true)
    expect(run({ DATABASE_URL: 'postgresql://postgres@postgres:5432/family_planner_dev' }).allowed).toBe(true)
  })

  it.each([
    ['production compose target', { DATABASE_URL: 'postgresql://u:p@postgres:5432/family_planner' }],
    ['remote host', { DATABASE_URL: 'postgresql://u:p@db.example.com:5432/fp_dev' }],
    ['production marker', { DATABASE_URL: 'postgresql://u:p@localhost:5432/family_prod' }],
    ['NODE_ENV=production', { DATABASE_URL: 'postgresql://u:p@localhost:5432/fp', NODE_ENV: 'production' }],
  ])('refuses a %s unless both the flag and the env confirmation are present', (_label, env) => {
    const none = run(env)
    expect(none.allowed).toBe(false)
    expect(none.reasons.join('\n')).toMatch(/--i-have-approval/)
    expect(none.reasons.join('\n')).toMatch(/BACKFILL_ALLOW_PRODUCTION=1/)
    expect(run(env, true).allowed).toBe(false)
    expect(run({ ...env, BACKFILL_ALLOW_PRODUCTION: '1' }).allowed).toBe(false)
    expect(run({ ...env, BACKFILL_ALLOW_PRODUCTION: 'yes' }, true).allowed).toBe(false)
    const ok = run({ ...env, BACKFILL_ALLOW_PRODUCTION: '1' }, true)
    expect(ok).toMatchObject({ allowed: true, approvedRemote: true })
  })

  it('always refuses a malformed DATABASE_URL, even with approval', () => {
    const approved = { BACKFILL_ALLOW_PRODUCTION: '1' }
    expect(run({ ...approved }, true).allowed).toBe(false)
    expect(run({ ...approved, DATABASE_URL: 'not a url' }, true).allowed).toBe(false)
    expect(run({ ...approved, DATABASE_URL: 'mysql://localhost/db' }, true).allowed).toBe(false)
    expect(run({ ...approved, DATABASE_URL: 'postgresql://localhost/db?host=prod.example.com' }, true).allowed).toBe(false)
  })

  it('never echoes credentials', () => {
    const v = run({ DATABASE_URL: 'postgresql://user:s3cret@db.example.com/fp' })
    expect(JSON.stringify(v)).not.toContain('s3cret')
  })
})

describe('argument parsing', () => {
  it('defaults to a dry-run over every family', () => {
    expect(parseBackfillArgs([])).toMatchObject({ mode: 'dry-run', families: [], allFamilies: false, approvalFlag: false })
  })

  it('requires an explicit family scope for writes', () => {
    expect(() => parseBackfillArgs(['--apply'])).toThrow(BackfillUsageError)
    expect(() => parseBackfillArgs(['--reverse'])).toThrow(BackfillUsageError)
    expect(parseBackfillArgs(['--apply', '--family', 'a', '--family', 'a'])).toMatchObject({ mode: 'apply', families: ['a'] })
    expect(parseBackfillArgs(['--reverse', '--all-families', '--job', 'j1'])).toMatchObject({ mode: 'reverse', allFamilies: true, jobId: 'j1' })
  })

  it('rejects contradictory or unknown arguments', () => {
    expect(() => parseBackfillArgs(['--apply', '--reverse', '--family', 'a'])).toThrow(/mutually exclusive/)
    expect(() => parseBackfillArgs(['--apply', '--all-families', '--family', 'a'])).toThrow(/mutually exclusive/)
    expect(() => parseBackfillArgs(['--family'])).toThrow(/needs a value/)
    expect(() => parseBackfillArgs(['--family', '--apply'])).toThrow(/needs a value/)
    expect(() => parseBackfillArgs(['--job', 'j'])).toThrow(/--reverse/)
    expect(() => parseBackfillArgs(['--apply', '--all-families', '--started-by', 'u'])).toThrow(/exactly one --family/)
    expect(() => parseBackfillArgs(['--yolo'])).toThrow(/Unknown argument/)
  })

  it('reads the approval flag', () => {
    expect(parseBackfillArgs(['--i-have-approval']).approvalFlag).toBe(true)
  })
})

describe('planFamilyBackfill on the fixture rehearsal rows', () => {
  const ds = buildFixtureDataset()
  const A = FIXTURE_IDS.familyA.family
  const B = FIXTURE_IDS.familyB.family

  it('plans family A: 2 created, 1 linked, 1 archived skip; 1 list + 2 items', () => {
    const plan = planFamilyBackfill(sourceFromDataset(ds, A), idGen())
    expect(plan.counts.meals).toEqual({ created: 2, linked: 1, skipped: 1, alreadyMapped: 0 })
    expect(plan.counts.mealPlans).toEqual({ archived: 1, alreadyMapped: 0 })
    expect(plan.counts.lists).toEqual({ created: 1, alreadyMapped: 0 })
    expect(plan.counts.items).toEqual({ created: 2, skipped: 0, alreadyMapped: 0 })
    expect(plan.counts.recipeRefsNulled).toBe(0)
    expect(reconcile(plan.counts).ok).toBe(true)

    expect(plan.mealLinks).toEqual([{ sourceId: L.familyA.entrySameName, mealId: L.familyA.mealSameName, setRecipeId: L.familyA.recipeLasagna }])
    expect(plan.mealCreates.map((m) => [m.sourceId, m.mealType, m.recipeId, m.recipeName])).toEqual([
      [L.familyA.entryOtherName, 'dinner', L.familyA.recipeSoup, 'Tomato soup'],
      [L.familyA.entryLunch, 'lunch', L.familyA.recipeStirFry, 'Tofu stir-fry'],
    ])
    expect(plan.skipped).toEqual([
      expect.objectContaining({ sourceModel: 'MealPlanEntry', sourceId: L.familyA.entryBrunch, reason: 'unmappable_meal_type', row: expect.objectContaining({ meal_type: 'Brunch' }) }),
    ])
    const [sheets, tomatoes] = plan.itemCreates
    expect(sheets).toMatchObject({ content: 'Lasagna sheets', checked: true, ingredientId: L.familyA.ingredientLasagnaSheets, position: 0, amount: 1, unit: 'box' })
    expect(tomatoes).toMatchObject({ content: 'tomatoes', recipeId: L.familyA.recipeSoup, ingredientId: L.familyA.ingredientTomatoes, position: 1 })
    expect(new Set(plan.itemCreates.map((i) => i.listId))).toEqual(new Set([plan.listCreates[0].id]))
  })

  it('plans family B: foreign references never cross households', () => {
    const plan = planFamilyBackfill(sourceFromDataset(ds, B), idGen())
    expect(plan.counts.meals).toEqual({ created: 0, linked: 0, skipped: 1, alreadyMapped: 0 })
    expect(plan.counts.items).toEqual({ created: 1, skipped: 1, alreadyMapped: 0 })
    expect(plan.counts.skipReasons).toEqual({ foreign_recipe: 1, empty_name: 1 })
    expect(plan.nulled).toEqual([{ sourceModel: 'ShoppingItem', sourceId: L.familyB.itemForeignRecipe, reason: 'foreign_recipe' }])
    expect(plan.itemCreates).toEqual([expect.objectContaining({ content: 'Paper towels (Family B)', recipeId: null, ingredientId: null })])
    expect(plan.skipped.map((s) => [s.sourceId, s.reason])).toEqual([
      [L.familyB.entryForeignRecipe, 'foreign_recipe'],
      [L.familyB.itemEmptyName, 'empty_name'],
    ])
    expect(reconcile(plan.counts).ok).toBe(true)
    // Nothing from Family A leaks into B's writes.
    expect(JSON.stringify([plan.mealCreates, plan.itemCreates, plan.listCreates])).not.toMatch(/fx_recipe_a|Veggie lasagna|Tomato soup/)
  })

  it('plans nothing when every row is already mapped', () => {
    const first = planFamilyBackfill(sourceFromDataset(ds, A), idGen())
    const mappings: FamilySource['mappings'] = {}
    const m = (model: string, id: string, targetModel: string, targetId: string) => {
      mappings[`${model}:${id}`] = { targetModel, targetId, marker: 'created' }
    }
    first.mealCreates.forEach((x) => m('MealPlanEntry', x.sourceId, 'FamilyMeal', x.id))
    first.mealLinks.forEach((x) => m('MealPlanEntry', x.sourceId, 'FamilyMeal', x.mealId))
    first.skipped.forEach((x) => m(x.sourceModel, x.sourceId, 'ImportJob', 'job'))
    first.planArchives.forEach((x) => m('MealPlan', x.id, 'ImportJob', 'job'))
    first.listCreates.forEach((x) => m('ShoppingList', x.sourceId, 'List', x.id))
    first.itemCreates.forEach((x) => m('ShoppingItem', x.sourceId, 'ListItem', x.id))
    const src = { ...sourceFromDataset(ds, A, mappings), existingListIds: first.listCreates.map((l) => l.id) }
    const again = planFamilyBackfill(src, idGen())
    expect(planHasWork(again)).toBe(false)
    expect(again.counts.meals).toEqual({ created: 0, linked: 0, skipped: 0, alreadyMapped: 4 })
    expect(reconcile(again.counts).ok).toBe(true)
  })

  it('links a second plan for the same slot to the meal created earlier in the run', () => {
    const src = sourceFromDataset(ds, A)
    const dup = { ...src.entries.find((e) => e.id === L.familyA.entryLunch)!, id: 'other_plan_entry' }
    const plan = planFamilyBackfill({ ...src, entries: [...src.entries, dup] }, idGen())
    expect(plan.counts.meals.created).toBe(2)
    expect(plan.counts.meals.linked).toBe(2)
    const created = plan.mealCreates.find((c) => c.sourceId === L.familyA.entryLunch)!
    expect(plan.mealLinks).toContainEqual({ sourceId: 'other_plan_entry', mealId: created.id, setRecipeId: null })
  })

  it('skips items whose mapped target list was deleted, and reports missing recipes', () => {
    const src = sourceFromDataset(ds, A, { [`ShoppingList:${L.familyA.shoppingList}`]: { targetModel: 'List', targetId: 'gone', marker: 'created' } })
    const plan = planFamilyBackfill(
      { ...src, shoppingItems: src.shoppingItems.map((i) => ({ ...i, recipeId: 'deleted_recipe', recipeFamilyId: null })) },
      idGen()
    )
    expect(plan.counts.items).toEqual({ created: 0, skipped: 2, alreadyMapped: 0 })
    expect(plan.counts.skipReasons.target_list_missing).toBe(2)
    expect(reconcile(plan.counts).ok).toBe(true)

    const withList = planFamilyBackfill(
      { ...sourceFromDataset(ds, A), shoppingItems: src.shoppingItems.map((i) => ({ ...i, recipeId: 'deleted_recipe', recipeFamilyId: null })) },
      idGen()
    )
    expect(withList.counts.nullReasons).toEqual({ missing_recipe: 2 })
  })

  it('detects a broken reconciliation', () => {
    const plan = planFamilyBackfill(sourceFromDataset(ds, A), idGen())
    const broken = { ...plan.counts, meals: { ...plan.counts.meals, created: 0 } }
    expect(reconcile(broken)).toMatchObject({ ok: false })
  })
})
