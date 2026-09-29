// Pure helpers of the food inventory (#263): dates, expiry labels, validation
// and the "what can I cook" ranking.

import {
  consumeInventorySchema,
  createInventorySchema,
  discardInventorySchema,
  getUseSoonItems,
  isUseSoonStatus,
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
  it('best before (the default, and every old row): a passed day is "check it", never "expired" food', () => {
    const cases: Array<[Date | null, string, number | null, string]> = [
      [null, 'none', null, 'No date'],
      [day(-2), 'expired', -2, 'Best before was 2 days ago'],
      [day(-1), 'expired', -1, 'Best before was yesterday'],
      [day(0), 'today', 0, 'Best before today'],
      [day(1), 'soon', 1, 'Best before tomorrow'],
      [day(3), 'soon', 3, 'Best before in 3 days'],
      [day(4), 'later', 4, 'Best before in 4 days'],
    ]
    for (const [value, status, daysLeft, label] of cases) {
      const s = expiryStatus(value, TODAY)
      expect(s).toEqual({ status, daysLeft })
      expect(expiryLabel(s.status, s.daysLeft)).toBe(label)
      // An unknown or missing kind reads as best before.
      expect(expiryStatus(value, TODAY, 3, null)).toEqual(s)
      expect(expiryLabel(s.status, s.daysLeft, 'something-else')).toBe(label)
    }
  })

  it('use by is stricter: after the day it is "Past use-by — don\'t eat" and never use-soon', () => {
    const cases: Array<[Date | null, string, number | null, string]> = [
      [null, 'none', null, 'No date'],
      [day(-2), 'past_use_by', -2, "Past use-by — don't eat"],
      [day(-1), 'past_use_by', -1, "Past use-by — don't eat"],
      [day(0), 'today', 0, 'Use by today'],
      [day(1), 'soon', 1, 'Use by tomorrow'],
      [day(3), 'soon', 3, 'Use within 3 days'],
      [day(4), 'later', 4, 'Use within 4 days'],
    ]
    for (const [value, status, daysLeft, label] of cases) {
      const s = expiryStatus(value, TODAY, 3, 'use_by')
      expect(s).toEqual({ status, daysLeft })
      expect(expiryLabel(s.status, s.daysLeft, 'use_by')).toBe(label)
    }
    expect(isUseSoonStatus('past_use_by')).toBe(false)
    expect(isUseSoonStatus('expired')).toBe(true)
    expect(isUseSoonStatus('none')).toBe(false)
    expect(isUseSoonStatus('later')).toBe(false)
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
    // Rows written before #158 read as an active best-before item.
    expect(dto).toMatchObject({
      date_kind: 'best_before',
      category: null,
      purchased_on: null,
      opened_on: null,
      status: 'active',
      finished_at: null,
    })
  })

  it('carries the #158 fields and classifies with the date kind', () => {
    const dto = toInventoryDto(
      {
        id: 'i2', name: 'Chicken', ingredient_id: null, amount: null, unit: null, location: 'fridge',
        expires_on: day(-1), date_kind: 'use_by', category: 'meat_fish', purchased_on: day(-4), opened_on: day(-2),
        status: 'consumed', finished_at: new Date('2026-01-05T09:00:00Z'), added_by: null, created_at: TODAY, updated_at: TODAY,
      },
      TODAY
    )
    expect(dto).toMatchObject({
      date_kind: 'use_by',
      category: 'meat_fish',
      purchased_on: '2026-01-01',
      opened_on: '2026-01-03',
      status: 'consumed',
      finished_at: '2026-01-05T09:00:00.000Z',
      expiry: { status: 'past_use_by', daysLeft: -1 },
    })
    // Unknown stored values fall back safely.
    const odd = toInventoryDto(
      {
        id: 'i3', name: 'x', ingredient_id: null, amount: null, unit: null, location: 'shed', expires_on: null,
        date_kind: 'weird', category: 'garage', status: 'lost', added_by: null, created_at: TODAY, updated_at: TODAY,
      },
      TODAY
    )
    expect(odd).toMatchObject({ location: 'fridge', date_kind: 'best_before', category: null, status: 'active' })
  })
})

/**
 * Daylight-saving boundaries (#158/#121 QA): America/Toronto springs forward
 * on 2026-03-08 (02:00 EST -> 03:00 EDT, a 23-hour day) and falls back on
 * 2026-11-01 (02:00 EDT -> 01:00 EST, a 25-hour day). The page sends the
 * viewer's LOCAL calendar day; date-only values are UTC-midnight days, so
 * "days left" must be whole calendar days on both sides of each change, and
 * the local day must never skip or repeat.
 */
describe('use-soon across America/Toronto DST changes', () => {
  // What a browser in Toronto sends as `today` (its local calendar day) at
  // this instant. Jest cannot switch the process time zone per file, so the
  // fixture computes the zone's day with Intl, as the browser does.
  const zoneDay = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const localDay = (iso: string) => zoneDay.format(new Date(iso))

  it('the viewer day steps one calendar day across spring-forward and fall-back', () => {
    // Spring forward: 2026-03-08 07:00Z is 03:00 EDT (02:00 EST never happens).
    expect(localDay('2026-03-08T04:59:00Z')).toBe('2026-03-07') // 23:59 EST
    expect(localDay('2026-03-08T05:00:00Z')).toBe('2026-03-08') // 00:00 EST
    expect(localDay('2026-03-08T07:30:00Z')).toBe('2026-03-08') // 03:30 EDT
    expect(localDay('2026-03-09T03:59:00Z')).toBe('2026-03-08') // 23:59 EDT
    expect(localDay('2026-03-09T04:00:00Z')).toBe('2026-03-09') // 00:00 EDT
    // Fall back: 01:00-02:00 happens twice on 2026-11-01.
    expect(localDay('2026-11-01T03:59:00Z')).toBe('2026-10-31') // 23:59 EDT
    expect(localDay('2026-11-01T05:30:00Z')).toBe('2026-11-01') // 01:30 EDT
    expect(localDay('2026-11-01T06:30:00Z')).toBe('2026-11-01') // 01:30 EST (again)
    expect(localDay('2026-11-02T04:59:00Z')).toBe('2026-11-01') // 23:59 EST
    expect(localDay('2026-11-02T05:00:00Z')).toBe('2026-11-02')
  })

  it('days left are whole calendar days on each side of the change, for both date kinds', () => {
    for (const [nowIso, expected] of [
      // Late evening before spring forward: local day 03-07 while UTC is already 03-08.
      ['2026-03-08T04:30:00Z', '2026-03-07'],
      ['2026-03-08T12:00:00Z', '2026-03-08'],
      ['2026-11-01T03:30:00Z', '2026-10-31'],
      ['2026-11-01T06:30:00Z', '2026-11-01'],
    ] as const) {
      const viewerDay = localDay(nowIso)
      expect(viewerDay).toBe(expected)
      const today = resolveToday(viewerDay, new Date(nowIso))
      expect(today).not.toBeNull()
      const kinds = ['best_before', 'use_by'] as const
      for (const kind of kinds) {
        // The change day itself and the days around it.
        const change = nowIso.startsWith('2026-03') ? '2026-03-08' : '2026-11-01'
        const status = expiryStatus(change, today!, 3, kind)
        const expectedLeft = Math.round((Date.parse(`${change}T00:00:00Z`) - Date.parse(`${expected}T00:00:00Z`)) / 86_400_000)
        expect(status.daysLeft).toBe(expectedLeft)
        expect(Number.isInteger(status.daysLeft)).toBe(true)
        expect(status.status).toBe(expectedLeft === 0 ? 'today' : 'soon')
      }
      // The day before the change: best before is "check it", use-by is "don't eat".
      const before = expected === '2026-03-08' ? '2026-03-07' : expected === '2026-11-01' ? '2026-10-31' : null
      if (before) {
        expect(expiryStatus(before, today!, 3, 'best_before')).toEqual({ status: 'expired', daysLeft: -1 })
        expect(expiryStatus(before, today!, 3, 'use_by')).toEqual({ status: 'past_use_by', daysLeft: -1 })
      }
    }
  })
})

/** A minimal inventoryItem reader: filters like the Prisma `where` used by getUseSoonItems. */
function fakeReader(rows: Array<Record<string, any>>) {
  const findMany = jest.fn(async (args: any) => {
    const w = args.where
    const cutoff: Date = w.OR[1].expires_on.gte
    const lte: Date = w.expires_on.lte
    const kept = rows.filter(
      (r) =>
        r.family_id === w.family_id &&
        (r.status ?? 'active') === w.status &&
        r.expires_on !== null &&
        r.expires_on.getTime() <= lte.getTime() &&
        ((r.date_kind ?? 'best_before') !== 'use_by' || r.expires_on.getTime() >= cutoff.getTime())
    )
    kept.sort(
      (a, b) =>
        a.expires_on.getTime() - b.expires_on.getTime() ||
        (b.date_kind ?? 'best_before').localeCompare(a.date_kind ?? 'best_before') ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id)
    )
    return kept.slice(0, args.take)
  })
  return { db: { inventoryItem: { findMany } } as any, findMany }
}

describe('getUseSoonItems', () => {
  const row = (id: string, name: string, expires: Date | null, extra: Record<string, unknown> = {}) => ({
    id, family_id: 'fam', name, location: 'fridge', expires_on: expires, ...extra,
  })

  it('is deterministic: date, then use-by first, then name; leaves out missing dates, finished items and passed use-by', async () => {
    const { db, findMany } = fakeReader([
      row('a', 'Yogurt', day(1)),
      row('b', 'Chicken', day(1), { date_kind: 'use_by' }),
      row('c', 'Apples', day(1)),
      row('d', 'Old milk', day(-2)), // best before passed: still listed, first
      row('e', 'Old fish', day(-1), { date_kind: 'use_by' }), // don't eat: never use-soon
      row('f', 'Rice', null), // no date: never use-soon
      row('g', 'Eaten cheese', day(0), { status: 'consumed' }),
      row('h', 'Binned salad', day(0), { status: 'discarded' }),
      row('i', 'Later', day(4)),
      row('j', 'Other family', day(0), { family_id: 'other' }),
      row('k', 'Ham', day(0), { date_kind: 'use_by' }),
    ])
    const items = await getUseSoonItems(db, 'fam', { today: TODAY })
    expect(items.map((i) => [i.id, i.status, i.label])).toEqual([
      ['d', 'expired', 'Best before was 2 days ago'],
      ['k', 'today', 'Use by today'],
      ['b', 'soon', 'Use by tomorrow'],
      ['c', 'soon', 'Best before tomorrow'],
      ['a', 'soon', 'Best before tomorrow'],
    ])
    expect(items[1]).toEqual({
      id: 'k', name: 'Ham', location: 'fridge', expiresOn: '2026-01-05', dateKind: 'use_by', daysLeft: 0, status: 'today', label: 'Use by today',
    })
    const where = findMany.mock.calls[0][0].where
    expect(where).toMatchObject({ family_id: 'fam', status: 'active' })
    // Same input, same output.
    expect(await getUseSoonItems(db, 'fam', { today: TODAY })).toEqual(items)
  })

  it('an earlier use-by cutoff (the board) keeps a use-by row that is still today for a viewer behind UTC', async () => {
    const { db } = fakeReader([row('k', 'Ham', day(0), { date_kind: 'use_by' })])
    expect(await getUseSoonItems(db, 'fam', { today: day(1) })).toEqual([])
    const kept = await getUseSoonItems(db, 'fam', { today: day(1), useByCutoff: day(-1) })
    expect(kept.map((i) => [i.id, i.status, i.dateKind])).toEqual([['k', 'soon', 'use_by']])
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
    const cleared = updateInventorySchema.safeParse({
      expires_on: null, amount: null, unit: null, ingredient_id: null, category: null, purchased_on: null, opened_on: null,
    })
    expect(cleared.success).toBe(true)
  })

  it('accepts the #158 fields and rejects bad values', () => {
    const ok = createInventorySchema.safeParse({
      name: 'Chicken', expires_on: '2026-01-07', date_kind: 'use_by', category: 'meat_fish', purchased_on: '2026-01-02', opened_on: null,
    })
    expect(ok.success).toBe(true)
    for (const body of [
      { name: 'x', date_kind: 'expiry' },
      { name: 'x', date_kind: null },
      { name: 'x', category: 'garage' },
      { name: 'x', purchased_on: '2026-02-30' },
      { name: 'x', opened_on: 'yesterday' },
      { name: 'x', status: 'consumed' },
      { name: 'x', finished_at: '2026-01-01' },
    ]) {
      expect(createInventorySchema.safeParse(body).success).toBe(false)
    }
    expect(updateInventorySchema.safeParse({ date_kind: 'use_by' }).success).toBe(true)
    expect(updateInventorySchema.safeParse({ status: 'active' }).success).toBe(false)
  })

  it('consume takes an optional positive amount; discard takes nothing', () => {
    expect(consumeInventorySchema.safeParse({}).success).toBe(true)
    expect(consumeInventorySchema.safeParse({ amount: null }).success).toBe(true)
    expect(consumeInventorySchema.safeParse({ amount: 0.5 }).success).toBe(true)
    for (const body of [{ amount: 0 }, { amount: -1 }, { amount: 'all' }, { amount: 1, kind: 'discard' }]) {
      expect(consumeInventorySchema.safeParse(body).success).toBe(false)
    }
    expect(discardInventorySchema.safeParse({}).success).toBe(true)
    expect(discardInventorySchema.safeParse({ amount: 1 }).success).toBe(false)
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
        { ingredient_id: null, name: 'Cheese', expires_on: day(-1), date_kind: 'use_by' },
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
