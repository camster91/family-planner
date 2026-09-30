import { buildTodayBoard } from '../today-board-data'
import { defaultFeatures } from '@/lib/features'

const NOW = new Date('2026-01-05T12:00:00.000Z')
const FAMILY = 'fam_a'

function mockDb(overrides: Partial<Record<string, unknown>> = {}) {
  const db = {
    user: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'u_parent', name: 'Avery Parent', color: 'indigo' },
        { id: 'u_child', name: 'Casey Child', color: 'sky' },
      ]),
    },
    event: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'e_local',
          title: 'Dentist',
          start_time: new Date('2026-01-05T14:00:00Z'),
          end_time: new Date('2026-01-05T15:00:00Z'),
          is_task: false,
          source_subscription_id: null,
        },
        {
          id: 'e_imported',
          title: 'Early dismissal',
          start_time: new Date('2026-01-05T15:00:00Z'),
          end_time: new Date('2026-01-05T16:00:00Z'),
          is_task: false,
          source_subscription_id: 'sub_a',
        },
        {
          id: 'e_foreign_sub',
          title: 'Odd import',
          start_time: new Date('2026-01-05T16:00:00Z'),
          end_time: new Date('2026-01-05T17:00:00Z'),
          is_task: true,
          source_subscription_id: 'sub_other_family',
        },
      ]),
    },
    chore: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'c1', title: 'Tidy room', due_date: new Date('2026-01-05T00:00:00Z'), status: 'pending', assigned_to: 'u_child', icon: 'tidy-toys' },
        // A stored key outside the catalogue (e.g. written by a newer build) is sent as no picture.
        { id: 'c2', title: 'Odd', due_date: new Date('2026-01-05T00:00:00Z'), status: 'pending', assigned_to: 'u_child', icon: 'not-a-key' },
        { id: 'c_orphan', title: 'Ghost', due_date: new Date('2026-01-05T00:00:00Z'), status: 'pending', assigned_to: 'u_gone' },
      ]),
    },
    familyMeal: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'm1',
          date: new Date('2026-01-05T00:00:00Z'),
          recipe_name: '  Tacos ',
          cook: { name: 'Avery Parent' },
          recipe: { title: 'Street tacos', prep_time: 20 },
        },
        { id: 'm2', date: new Date('2026-01-06T00:00:00Z'), recipe_name: '', cook: null, recipe: null },
      ]),
    },
    calendarSubscription: {
      findMany: jest.fn().mockResolvedValue([{ id: 'sub_a', name: 'School calendar', color: '#0079A8' }]),
    },
    listItem: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'i1', content: 'Milk', quantity: 2, list: { id: 'l1', name: 'Groceries' } },
      ]),
      count: jest.fn().mockResolvedValue(1),
    },
    ...overrides,
  }
  return db
}

/** Every key selected anywhere in a Prisma `select` tree. */
function selectedKeys(select: Record<string, unknown>): string[] {
  return Object.entries(select).flatMap(([k, v]) =>
    v && typeof v === 'object' && 'select' in (v as object)
      ? [k, ...selectedKeys((v as { select: Record<string, unknown> }).select)]
      : [k]
  )
}

describe('buildTodayBoard (shared-surface DTO)', () => {
  it('scopes every query to the household and selects only approved fields', async () => {
    const db = mockDb()
    await buildTodayBoard(db as any, { familyId: FAMILY, role: 'parent', features: defaultFeatures(), now: NOW })

    const userArgs = db.user.findMany.mock.calls[0][0]
    const eventArgs = db.event.findMany.mock.calls[0][0]
    const choreArgs = db.chore.findMany.mock.calls[0][0]
    const mealArgs = db.familyMeal.findMany.mock.calls[0][0]
    const subArgs = db.calendarSubscription.findMany.mock.calls[0][0]

    for (const args of [userArgs, eventArgs, choreArgs, mealArgs, subArgs]) {
      expect(args.where.family_id).toBe(FAMILY)
    }
    expect(db.listItem.findMany.mock.calls[0][0].where.list.family_id).toBe(FAMILY)

    expect(selectedKeys(userArgs.select).sort()).toEqual(['board_color', 'id', 'name'])
    // Free-text fields that can carry addresses or private notes are never read.
    expect(selectedKeys(eventArgs.select)).not.toContain('description')
    expect(selectedKeys(eventArgs.select)).not.toContain('location')
    expect(selectedKeys(mealArgs.select)).not.toContain('notes')
    // ADR-0007: only the linked recipe's title and prep time reach the board.
    expect(mealArgs.select.recipe).toEqual({ select: { title: true, prep_time: true } })
    expect(selectedKeys(mealArgs.select)).not.toContain('instructions')
    expect(selectedKeys(mealArgs.select)).not.toContain('description')
    expect(selectedKeys(choreArgs.select)).not.toContain('description')
    expect(selectedKeys(choreArgs.select)).not.toContain('points')
    // #272: the picture key, but not the routine label (free text) or step.
    expect(selectedKeys(choreArgs.select).sort()).toEqual(['assigned_to', 'due_date', 'icon', 'id', 'status', 'title'])
    expect(selectedKeys(subArgs.select).sort()).toEqual(['color', 'id', 'name'])
  })

  it('never touches private domains', async () => {
    const db = mockDb()
    const forbidden = {
      transaction: { findMany: jest.fn(), aggregate: jest.fn() },
      budgetCategory: { findMany: jest.fn(), aggregate: jest.fn() },
      message: { findMany: jest.fn() },
      medication: { findMany: jest.fn() },
      sickDay: { findMany: jest.fn() },
      familyLocation: { findMany: jest.fn() },
      handoff: { findMany: jest.fn(), findFirst: jest.fn() },
      allowance: { findMany: jest.fn() },
    }
    await buildTodayBoard({ ...db, ...forbidden } as any, {
      familyId: FAMILY,
      role: 'parent',
      features: defaultFeatures(),
      now: NOW,
    })
    for (const delegate of Object.values(forbidden)) {
      for (const fn of Object.values(delegate)) expect(fn).not.toHaveBeenCalled()
    }
  })

  it('maps rows to the DTO with imported-event sources resolved in the household only', async () => {
    const data = await buildTodayBoard(mockDb() as any, {
      familyId: FAMILY,
      role: 'parent',
      features: defaultFeatures(),
      now: NOW,
    })
    expect(data.generatedAt).toBe(NOW.toISOString())
    expect(data.members).toEqual([
      { id: 'u_parent', name: 'Avery Parent', color: 'indigo' },
      { id: 'u_child', name: 'Casey Child', color: 'sky' },
    ])
    expect(data.events.map((e) => [e.id, e.source])).toEqual([
      ['e_local', null],
      ['e_imported', { name: 'School calendar', color: '#0079A8' }],
      // The subscription lookup is family-scoped, so a foreign id gets a generic label.
      ['e_foreign_sub', { name: 'Subscribed calendar', color: null }],
    ])
    expect(data.chores).toEqual([
      { id: 'c1', title: 'Tidy room', dueDay: '2026-01-05', status: 'pending', assigneeId: 'u_child', icon: 'tidy-toys' },
      { id: 'c2', title: 'Odd', dueDay: '2026-01-05', status: 'pending', assigneeId: 'u_child', icon: null },
    ])
    expect(data.dinners).toEqual([
      { id: 'm1', day: '2026-01-05', recipeName: 'Tacos', cookName: 'Avery Parent', recipeTitle: 'Street tacos', prepMinutes: 20 },
      { id: 'm2', day: '2026-01-06', recipeName: null, cookName: null, recipeTitle: null, prepMinutes: null },
    ])
    expect(data.shopping).toEqual({
      items: [{ id: 'i1', content: 'Milk', quantity: 2, listId: 'l1', listName: 'Groceries' }],
      total: 1,
    })
    expect(data.links).toEqual({
      calendar: '/dashboard/calendar',
      chores: '/dashboard/chores',
      meals: '/dashboard/meals',
      lists: '/dashboard/lists',
      features: '/dashboard/features',
      // Inventory is off by default (#263), so no link.
      inventory: null,
    })
  })

  it('queries a window that covers today plus the coming days in any zone', async () => {
    const db = mockDb()
    await buildTodayBoard(db as any, { familyId: FAMILY, role: 'parent', features: defaultFeatures(), now: NOW })
    const eventWhere = db.event.findMany.mock.calls[0][0].where
    expect(eventWhere.end_time.gt).toEqual(NOW)
    expect(eventWhere.start_time.lt.toISOString()).toBe('2026-01-10T00:00:00.000Z')
    const choreWhere = db.chore.findMany.mock.calls[0][0].where
    expect(choreWhere.due_date.gte.toISOString()).toBe('2026-01-04T00:00:00.000Z')
    expect(choreWhere.due_date.lt.toISOString()).toBe('2026-01-10T00:00:00.000Z')
  })

  it('offers kids only the links they can open', async () => {
    for (const role of ['child', 'teen']) {
      const data = await buildTodayBoard(mockDb() as any, {
        familyId: FAMILY,
        role,
        features: defaultFeatures(),
        now: NOW,
      })
      expect(data.links).toEqual({ calendar: null, chores: null, meals: null, lists: '/dashboard/lists', features: null, inventory: null })
      // Shared household data every member may already read (ROLE_AND_ISOLATION_MATRIX.md).
      expect(data.shopping?.total).toBe(1)
      expect(data.chores).toHaveLength(2)
    }
  })

  it('does not read meals when meal planning is off', async () => {
    const db = mockDb()
    const features = { ...defaultFeatures(), meals: false }
    const data = await buildTodayBoard(db as any, { familyId: FAMILY, role: 'parent', features, now: NOW })
    expect(db.familyMeal.findMany).not.toHaveBeenCalled()
    expect(data.dinners).toBeNull()
    expect(data.links.meals).toBeNull()
  })

  it('skips the subscription lookup when nothing is imported', async () => {
    const db = mockDb({
      event: { findMany: jest.fn().mockResolvedValue([]) },
    })
    const data = await buildTodayBoard(db as any, { familyId: FAMILY, role: 'parent', features: defaultFeatures(), now: NOW })
    expect(db.calendarSubscription.findMany).not.toHaveBeenCalled()
    expect(data.events).toEqual([])
  })

  // Shared device (#240, SHARED_DEVICE.md §9.1 and §14.1 item 4).
  describe("audience 'device'", () => {
    it('returns every link null, even where a null role would get all links', async () => {
      const nullRole = await buildTodayBoard(mockDb() as any, {
        familyId: FAMILY,
        role: null,
        features: defaultFeatures(),
        now: NOW,
      })
      expect(Object.values(nullRole.links).some((l) => l !== null)).toBe(true)

      const device = await buildTodayBoard(mockDb() as any, {
        familyId: FAMILY,
        audience: 'device',
        features: defaultFeatures(),
        now: NOW,
      })
      expect(device.links).toEqual({ calendar: null, chores: null, meals: null, lists: null, features: null, inventory: null })
    })

    it('reads the same household-scoped, allowlisted data as the person board', async () => {
      const db = mockDb()
      const data = await buildTodayBoard(db as any, {
        familyId: FAMILY,
        audience: 'device',
        features: defaultFeatures(),
        now: NOW,
      })
      expect(db.user.findMany.mock.calls[0][0]).toMatchObject({
        where: { family_id: FAMILY },
        select: { id: true, name: true },
      })
      expect(data.members).toEqual([
        { id: 'u_parent', name: 'Avery Parent', color: 'indigo' },
        { id: 'u_child', name: 'Casey Child', color: 'sky' },
      ])
      expect(data.shopping?.total).toBe(1)
      expect(data.dinners).toHaveLength(2)
      // #272: the tablet gets the chore's catalogue picture key and nothing else new.
      expect(Object.keys(data.chores[0]).sort()).toEqual(['assigneeId', 'dueDay', 'icon', 'id', 'status', 'title'])
      expect(data.chores[0].icon).toBe('tidy-toys')
    })

    it('includes shopping only when the lists feature is on', async () => {
      const db = mockDb()
      const data = await buildTodayBoard(db as any, {
        familyId: FAMILY,
        audience: 'device',
        features: { ...defaultFeatures(), lists: false },
        now: NOW,
      })
      expect(data.shopping).toBeNull()
      expect(db.listItem.findMany).not.toHaveBeenCalled()
    })
  })

  describe('member colours and who added an event (#262)', () => {
    it('uses a parent-chosen colour, falls back by household order, and ignores unknown keys', async () => {
      const db = mockDb({
        user: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'u_parent', name: 'Avery Parent', board_color: null },
            { id: 'u_teen', name: 'Blake Teen', board_color: 'indigo' },
            { id: 'u_child', name: 'Casey Child', board_color: 'not-a-colour' },
          ]),
        },
      })
      const data = await buildTodayBoard(db as any, { familyId: FAMILY, role: 'parent', features: defaultFeatures(), now: NOW })
      // Blake chose indigo, so the fallbacks skip it.
      expect(data.members.map((m) => [m.id, m.color])).toEqual([
        ['u_parent', 'sky'],
        ['u_teen', 'indigo'],
        ['u_child', 'green'],
      ])
      // Only the colour key leaves the server, never the raw column.
      for (const m of data.members) expect(Object.keys(m).sort()).toEqual(['color', 'id', 'name'])
    })

    it('names the member who added a local event, never for subscribed or provider-synced imports or non-members', async () => {
      const base = { end_time: new Date('2026-01-05T15:00:00Z'), start_time: new Date('2026-01-05T14:00:00Z'), is_task: false }
      const db = mockDb({
        event: {
          findMany: jest.fn().mockResolvedValue([
            { ...base, id: 'e_mine', title: 'Dentist', source_subscription_id: null, created_by: 'u_parent' },
            { ...base, id: 'e_import', title: 'Assembly', source_subscription_id: 'sub_a', created_by: 'u_parent' },
            { ...base, id: 'e_gone', title: 'Old', source_subscription_id: null, created_by: 'u_left_household' },
            // Provider-synced (#264): created_by is the connection owner, not an author.
            { ...base, id: 'e_synced', title: 'Work sync', source_subscription_id: null, source_connection_id: 'conn_a', created_by: 'u_parent' },
          ]),
        },
      })
      const data = await buildTodayBoard(db as any, { familyId: FAMILY, audience: 'device', features: defaultFeatures(), now: NOW })
      expect(db.event.findMany.mock.calls[0][0].select).toMatchObject({ created_by: true, source_connection_id: true })
      expect(data.events.map((e) => [e.id, e.addedById])).toEqual([
        ['e_mine', 'u_parent'],
        ['e_import', null],
        ['e_gone', null],
        ['e_synced', null],
      ])
    })
  })

  // #122: "N ingredients missing" on the dinner card.
  describe('missing ingredients for dinner', () => {
    const withIngredients = () =>
      jest.fn().mockResolvedValue([
        {
          id: 'm1',
          date: new Date('2026-01-05T00:00:00Z'),
          recipe_name: 'Tacos',
          cook: null,
          recipe: {
            title: 'Street tacos',
            prep_time: 20,
            ingredients: [
              { ingredient: { id: 'ing-tortilla', name: 'Tortillas' } },
              { ingredient: { id: 'ing-beans', name: 'Black beans' } },
              { ingredient: { id: 'ing-salsa', name: 'Salsa' } },
            ],
          },
        },
        // Linked recipe without ingredients: no count.
        { id: 'm2', date: new Date('2026-01-06T00:00:00Z'), recipe_name: null, cook: null, recipe: { title: 'Soup', prep_time: null, ingredients: [] } },
        // Free-text dinner: no count.
        { id: 'm3', date: new Date('2026-01-07T00:00:00Z'), recipe_name: 'Leftovers', cook: null, recipe: null },
      ])
    const stock = [
      { ingredient_id: 'ing-tortilla', name: 'Tortillas', expires_on: null, date_kind: 'best_before' },
      // Unlinked, matched by name like "What can I cook".
      { ingredient_id: null, name: ' black BEANS ', expires_on: new Date('2026-01-09T00:00:00Z'), date_kind: 'best_before' },
    ]
    const inventoryOn = { ...defaultFeatures(), inventory: true }

    it('counts missing ingredients for a member when inventory is on, and sends only the count', async () => {
      // Use-soon reads twice (main + use-by skew), then the matching read.
      const findMany = jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce(stock)
      const db = mockDb({ familyMeal: { findMany: withIngredients() }, inventoryItem: { findMany } })
      const data = await buildTodayBoard(db as any, { familyId: FAMILY, role: 'parent', features: inventoryOn, now: NOW })

      const mealArgs = (db.familyMeal.findMany as jest.Mock).mock.calls[0][0]
      expect(mealArgs.select.recipe.select.ingredients).toEqual({ select: { ingredient: { select: { id: true, name: true } } } })
      const matchArgs = findMany.mock.calls[2][0]
      expect(matchArgs.where).toMatchObject({ family_id: FAMILY, status: 'active' })
      expect(Object.keys(matchArgs.select).sort()).toEqual(['date_kind', 'expires_on', 'ingredient_id', 'name'])

      expect(data.dinners?.[0]).toEqual({
        id: 'm1',
        day: '2026-01-05',
        recipeName: 'Tacos',
        cookName: null,
        recipeTitle: 'Street tacos',
        prepMinutes: 20,
        missingIngredients: 1,
      })
      expect(data.dinners?.[1]).not.toHaveProperty('missingIngredients')
      expect(data.dinners?.[2]).not.toHaveProperty('missingIngredients')
      // Ingredient names never leave the server.
      expect(JSON.stringify(data.dinners)).not.toContain('Salsa')
    })

    it('does not read ingredients or count when inventory is off', async () => {
      const db = mockDb({ inventoryItem: { findMany: jest.fn() } })
      const data = await buildTodayBoard(db as any, { familyId: FAMILY, role: 'parent', features: defaultFeatures(), now: NOW })
      expect(db.familyMeal.findMany.mock.calls[0][0].select.recipe).toEqual({ select: { title: true, prep_time: true } })
      expect((db as any).inventoryItem.findMany).not.toHaveBeenCalled()
      for (const d of data.dinners ?? []) expect(d).not.toHaveProperty('missingIngredients')
    })

    it('never counts for a shared device (SHARED_DEVICE.md §9.1)', async () => {
      const findMany = jest.fn().mockResolvedValue([])
      const db = mockDb({ familyMeal: { findMany: withIngredients() }, inventoryItem: { findMany } })
      const data = await buildTodayBoard(db as any, { familyId: FAMILY, audience: 'device', features: inventoryOn, now: NOW })
      expect((db.familyMeal.findMany as jest.Mock).mock.calls[0][0].select.recipe).toEqual({ select: { title: true, prep_time: true } })
      // Only the two use-soon reads; no matching read.
      expect(findMany).toHaveBeenCalledTimes(2)
      for (const d of data.dinners ?? []) expect(d).not.toHaveProperty('missingIngredients')
    })

    it('shows no count when the inventory is larger than the scan cap', async () => {
      const many = Array.from({ length: 5001 }, (_, i) => ({ ingredient_id: `x${i}`, name: `X${i}`, expires_on: null, date_kind: 'best_before' }))
      const findMany = jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce(many)
      const db = mockDb({ familyMeal: { findMany: withIngredients() }, inventoryItem: { findMany } })
      const data = await buildTodayBoard(db as any, { familyId: FAMILY, role: 'parent', features: inventoryOn, now: NOW })
      expect(data.dinners?.[0]).not.toHaveProperty('missingIngredients')
    })
  })

  describe('use soon (#263 data, #262 tile)', () => {
    const inventoryRows = [
      { id: 'inv1', name: 'Spinach', location: 'fridge', expires_on: new Date('2026-01-04T00:00:00Z') },
      { id: 'inv2', name: 'Yogurt', location: 'fridge', expires_on: new Date('2026-01-07T00:00:00Z') },
    ]

    it('does not read inventory when the feature is off (the default), and has no link', async () => {
      const db = mockDb({ inventoryItem: { findMany: jest.fn() } })
      const data = await buildTodayBoard(db as any, { familyId: FAMILY, role: 'parent', features: defaultFeatures(), now: NOW })
      expect(data.useSoon).toBeNull()
      expect(data.links.inventory).toBeNull()
      expect((db as any).inventoryItem.findMany).not.toHaveBeenCalled()
    })

    it('reads the household window with board-safe fields only when the feature is on', async () => {
      const findMany = jest.fn().mockResolvedValueOnce(inventoryRows).mockResolvedValueOnce([])
      const db = mockDb({ inventoryItem: { findMany } })
      const features = { ...defaultFeatures(), inventory: true }
      const data = await buildTodayBoard(db as any, { familyId: FAMILY, role: 'child', features, now: NOW })
      const args = findMany.mock.calls[0][0]
      expect(args.where.family_id).toBe(FAMILY)
      // One UTC day ahead plus the 3-day window covers the viewer's local today in any zone.
      expect(args.where.expires_on.lte.toISOString()).toBe('2026-01-09T00:00:00.000Z')
      expect(Object.keys(args.select).sort()).toEqual(['date_kind', 'expires_on', 'id', 'location', 'name'])
      // Active items only (#158). The main set keeps use-by days from the
      // anchor day on; the zone-skew days (UTC yesterday and today) are a
      // separate, separately capped use-by set.
      expect(args.where.status).toBe('active')
      expect(args.where.OR[1].expires_on.gte.toISOString()).toBe('2026-01-06T00:00:00.000Z')
      const skew = findMany.mock.calls[1][0]
      expect(skew.where).toMatchObject({ family_id: FAMILY, status: 'active', date_kind: 'use_by' })
      expect(skew.where.expires_on.gte.toISOString()).toBe('2026-01-04T00:00:00.000Z')
      expect(skew.where.expires_on.lt.toISOString()).toBe('2026-01-06T00:00:00.000Z')
      expect(skew.take).toBe(50)
      expect(data.useSoon).toEqual([
        { id: 'inv1', name: 'Spinach', location: 'fridge', expiresOn: '2026-01-04', dateKind: 'best_before' },
        { id: 'inv2', name: 'Yogurt', location: 'fridge', expiresOn: '2026-01-07', dateKind: 'best_before' },
      ])
      // The inventory page is on the kid allowlist, so a child gets the link.
      expect(data.links.inventory).toBe('/dashboard/inventory')
    })

    it('gives the device the same items and no link', async () => {
      const db = mockDb({ inventoryItem: { findMany: jest.fn().mockResolvedValueOnce(inventoryRows).mockResolvedValueOnce([]) } })
      const data = await buildTodayBoard(db as any, {
        familyId: FAMILY,
        audience: 'device',
        features: { ...defaultFeatures(), inventory: true },
        now: NOW,
      })
      expect(data.useSoon).toHaveLength(2)
      expect(data.links.inventory).toBeNull()
    })
  })
})
