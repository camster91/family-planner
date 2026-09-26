import { buildTodayBoard } from '../today-board-data'
import { defaultFeatures } from '@/lib/features'

const NOW = new Date('2026-01-05T12:00:00.000Z')
const FAMILY = 'fam_a'

function mockDb(overrides: Partial<Record<string, unknown>> = {}) {
  const db = {
    user: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'u_parent', name: 'Avery Parent' },
        { id: 'u_child', name: 'Casey Child' },
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
        { id: 'c1', title: 'Tidy room', due_date: new Date('2026-01-05T00:00:00Z'), status: 'pending', assigned_to: 'u_child' },
        { id: 'c_orphan', title: 'Ghost', due_date: new Date('2026-01-05T00:00:00Z'), status: 'pending', assigned_to: 'u_gone' },
      ]),
    },
    familyMeal: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'm1', date: new Date('2026-01-05T00:00:00Z'), recipe_name: '  Tacos ', cook: { name: 'Avery Parent' } },
        { id: 'm2', date: new Date('2026-01-06T00:00:00Z'), recipe_name: '', cook: null },
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

    expect(selectedKeys(userArgs.select).sort()).toEqual(['id', 'name'])
    // Free-text fields that can carry addresses or private notes are never read.
    expect(selectedKeys(eventArgs.select)).not.toContain('description')
    expect(selectedKeys(eventArgs.select)).not.toContain('location')
    expect(selectedKeys(mealArgs.select)).not.toContain('notes')
    expect(selectedKeys(choreArgs.select)).not.toContain('description')
    expect(selectedKeys(choreArgs.select)).not.toContain('points')
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
      { id: 'u_parent', name: 'Avery Parent' },
      { id: 'u_child', name: 'Casey Child' },
    ])
    expect(data.events.map((e) => [e.id, e.source])).toEqual([
      ['e_local', null],
      ['e_imported', { name: 'School calendar', color: '#0079A8' }],
      // The subscription lookup is family-scoped, so a foreign id gets a generic label.
      ['e_foreign_sub', { name: 'Subscribed calendar', color: null }],
    ])
    expect(data.chores).toEqual([{ id: 'c1', title: 'Tidy room', dueDay: '2026-01-05', status: 'pending', assigneeId: 'u_child' }])
    expect(data.dinners).toEqual([
      { id: 'm1', day: '2026-01-05', recipeName: 'Tacos', cookName: 'Avery Parent' },
      { id: 'm2', day: '2026-01-06', recipeName: null, cookName: null },
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
      expect(data.links).toEqual({ calendar: null, chores: null, meals: null, lists: '/dashboard/lists', features: null })
      // Shared household data every member may already read (ROLE_AND_ISOLATION_MATRIX.md).
      expect(data.shopping?.total).toBe(1)
      expect(data.chores).toHaveLength(1)
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
})
