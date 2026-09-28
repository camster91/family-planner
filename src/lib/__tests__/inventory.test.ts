// Pure helpers of the food inventory (#263): dates, expiry labels, validation
// and the "what can I cook" ranking.

import {
  createInventorySchema,
  dayDiff,
  expiryLabel,
  expiryStatus,
  parseDays,
  rankCookableRecipes,
  resolveToday,
  toInventoryDto,
  updateInventorySchema,
  type CookRecipeInput,
} from '@/lib/inventory'

const TODAY = new Date('2026-01-05T00:00:00Z')
const day = (n: number) => new Date(TODAY.getTime() + n * 86_400_000)

describe('resolveToday', () => {
  const now = new Date('2026-01-05T12:00:00Z')

  it('defaults to the server UTC day', () => {
    expect(resolveToday(null, now)).toEqual(TODAY)
    expect(resolveToday('', now)).toEqual(TODAY)
  })

  it('accepts the viewer day within one day of the server date', () => {
    expect(resolveToday('2026-01-04', now)).toEqual(day(-1))
    expect(resolveToday('2026-01-06', now)).toEqual(day(1))
  })

  it('rejects malformed, impossible or far-away days', () => {
    for (const bad of ['2026-1-5', '2026-02-31', 'today', '2026-01-08', '2025-12-31']) {
      expect(resolveToday(bad, now)).toBeNull()
    }
  })
})

describe('parseDays', () => {
  it('parses whole days 0-365 and falls back when absent', () => {
    expect(parseDays(null, 3)).toBe(3)
    expect(parseDays('0', 3)).toBe(0)
    expect(parseDays('365', 3)).toBe(365)
    expect(parseDays('366', 3)).toBeNull()
    expect(parseDays('-1', 3)).toBeNull()
    expect(parseDays('1.5', 3)).toBeNull()
    expect(parseDays('x', 3)).toBeNull()
  })
})

describe('expiryStatus / expiryLabel', () => {
  it('classifies relative to today with a text label for every state', () => {
    const cases: Array<[Date | null, string, number | null, string]> = [
      [null, 'none', null, 'No date'],
      [day(-2), 'expired', -2, 'Expired 2 days ago'],
      [day(-1), 'expired', -1, 'Expired yesterday'],
      [day(0), 'today', 0, 'Use today'],
      [day(1), 'soon', 1, 'Use by tomorrow'],
      [day(3), 'soon', 3, 'Use in 3 days'],
      [day(4), 'later', 4, 'Use in 4 days'],
    ]
    for (const [value, status, daysLeft, label] of cases) {
      const s = expiryStatus(value, TODAY)
      expect(s).toEqual({ status, daysLeft })
      expect(expiryLabel(s.status, s.daysLeft)).toBe(label)
    }
  })

  it('accepts date-only strings and honours a custom window', () => {
    expect(expiryStatus('2026-01-10', TODAY, 7)).toEqual({ status: 'soon', daysLeft: 5 })
    expect(expiryStatus('2026-01-10T00:00:00.000Z', TODAY, 3)).toEqual({ status: 'later', daysLeft: 5 })
    expect(dayDiff(TODAY, day(10))).toBe(10)
  })
})

describe('toInventoryDto', () => {
  it('returns expires_on as YYYY-MM-DD and never the household id', () => {
    const dto = toInventoryDto(
      {
        id: 'i1', name: 'Milk', ingredient_id: null, amount: 1, unit: 'L', location: 'fridge',
        expires_on: day(1), added_by: 'u1', created_at: TODAY, updated_at: TODAY,
      },
      TODAY
    )
    expect(dto).toMatchObject({ expires_on: '2026-01-06', expiry: { status: 'soon', daysLeft: 1 }, location: 'fridge' })
    expect(dto).not.toHaveProperty('family_id')
  })
})

describe('validation', () => {
  it('creates with a name and sensible optional fields', () => {
    const ok = createInventorySchema.safeParse({ name: ' Milk ', amount: 2, unit: 'L', location: 'fridge', expires_on: '2026-01-07' })
    expect(ok.success).toBe(true)
    expect(ok.success && ok.data.name).toBe('Milk')
  })

  it('rejects bad input and unknown keys', () => {
    const bad = [
      {},
      { name: '' },
      { name: 'x'.repeat(201) },
      { name: 'Milk', location: 'garage' },
      { name: 'Milk', expires_on: '2026-02-31' },
      { name: 'Milk', expires_on: '07/01/2026' },
      { name: 'Milk', amount: -1 },
      { name: 'Milk', family_id: 'family-B' },
      { name: 'Milk', added_by: 'someone' },
    ]
    for (const body of bad) expect(createInventorySchema.safeParse(body).success).toBe(false)
  })

  it('update needs at least one field; null clears optional fields', () => {
    expect(updateInventorySchema.safeParse({}).success).toBe(false)
    const cleared = updateInventorySchema.safeParse({ expires_on: null, amount: null, unit: null, ingredient_id: null })
    expect(cleared.success).toBe(true)
  })
})

describe('rankCookableRecipes', () => {
  const recipe = (id: string, title: string, ingredients: Array<[string, string]>): CookRecipeInput => ({
    id,
    title,
    prep_time: 10,
    cook_time: null,
    servings: 2,
    ingredients: ingredients.map(([iid, name]) => ({ ingredient: { id: iid, name } })),
  })

  const recipes = [
    recipe('r-omelette', 'Omelette', [['ing-egg', 'Eggs'], ['ing-cheese', 'Cheese']]),
    recipe('r-soup', 'Tomato soup', [['ing-tomato', 'Tomatoes'], ['ing-onion', 'Red  Onion'], ['ing-stock', 'Stock']]),
    recipe('r-cake', 'Cake', [['ing-flour', 'Flour'], ['ing-egg', 'Eggs'], ['ing-sugar', 'Sugar'], ['ing-butter', 'Butter']]),
    recipe('r-none', 'Nothing in stock', [['ing-saffron', 'Saffron']]),
    recipe('r-empty', 'No ingredients', []),
  ]

  it('ranks by coverage, reports have and missing ids, and skips recipes with nothing in stock', () => {
    const ranked = rankCookableRecipes(
      recipes,
      [
        { ingredient_id: 'ing-egg', name: 'Eggs', expires_on: day(10) },
        { ingredient_id: 'ing-cheese', name: 'Cheddar', expires_on: null },
        // Unlinked, matched by normalized name.
        { ingredient_id: null, name: '  red onion ', expires_on: null },
        { ingredient_id: 'ing-tomato', name: 'Tomatoes', expires_on: day(1) },
      ],
      TODAY
    )
    expect(ranked.map((r) => r.recipeId)).toEqual(['r-omelette', 'r-soup', 'r-cake'])
    expect(ranked[0]).toMatchObject({ haveCount: 2, missingCount: 0, coverage: 1, totalCount: 2 })
    expect(ranked[1]).toMatchObject({ haveCount: 2, missingCount: 1, coverage: 0.67, useSoonCount: 1 })
    expect(ranked[1].missing).toEqual([{ ingredientId: 'ing-stock', name: 'Stock' }])
    expect(ranked[1].have.map((h) => h.ingredientId).sort()).toEqual(['ing-onion', 'ing-tomato'])
    expect(ranked[2].missing.map((m) => m.ingredientId)).toEqual(['ing-butter', 'ing-flour', 'ing-sugar'])
  })

  it('never counts expired items, and a linked item matches by id only', () => {
    const ranked = rankCookableRecipes(
      recipes,
      [
        { ingredient_id: 'ing-egg', name: 'Eggs', expires_on: day(-1) },
        // Linked to another ingredient: its name does not make "Cheese" in stock.
        { ingredient_id: 'ing-other', name: 'Cheese', expires_on: null },
      ],
      TODAY
    )
    expect(ranked).toEqual([])
  })

  it('breaks ties by use-soon items, then fewer missing, then title', () => {
    const ranked = rankCookableRecipes(
      [
        recipe('r-b', 'B', [['x', 'X'], ['y', 'Y']]),
        recipe('r-a', 'A', [['x', 'X'], ['z', 'Z']]),
        recipe('r-c', 'C', [['w', 'W'], ['v', 'V']]),
      ],
      [
        { ingredient_id: 'x', name: 'X', expires_on: null },
        { ingredient_id: 'w', name: 'W', expires_on: day(0) },
      ],
      TODAY
    )
    expect(ranked.map((r) => r.recipeId)).toEqual(['r-c', 'r-a', 'r-b'])
  })

  it('returns nothing for an empty inventory', () => {
    expect(rankCookableRecipes(recipes, [], TODAY)).toEqual([])
  })
})
