// Recurring series keep going after the first window, against real Postgres.
//
// Generated copies are stored with frequency 'once', so completing one used to
// leave the series alone; and a frequency edit only rewrote the column. These
// cover: completing a copy extends the series, repeat completes add nothing,
// the read-time top-up is idempotent and household-scoped, and PATCH
// once -> weekly starts a series (and a template set to 'once' stops it,
// O-33). Opt-in like the other integration suites: RUN_DB_INTEGRATION=1
// DATABASE_URL=... against a disposable database prepared by
// `node scripts/migrate.js`.

jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('@/lib/session', () => ({
  verifySessionToken: async (token: string) => {
    if (!token?.startsWith('session:')) return null
    const { prisma } = require('@/lib/prisma')
    const u = await prisma.user.findUnique({ where: { id: token.slice(8) } })
    return u ? { userId: u.id, email: u.email, role: u.role, family_id: u.family_id, tv: u.token_version } : null
  },
  getTokenVersion: async () => 0,
}))
jest.mock('@/lib/notifications-server', () => require('@/__tests__/helpers/two-household').notificationsMock)

export {}

const describeWithDatabase = process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip

jest.setTimeout(60_000)

describeWithDatabase('recurring chore series against Postgres', () => {
  let prisma: NonNullable<typeof import('@/lib/prisma').prisma>
  let recurring: typeof import('@/lib/recurringChores')
  let complete: typeof import('@/lib/chore-complete')
  let route: typeof import('@/app/api/chores/route')
  let createRoute: typeof import('@/app/api/chores/create/route')

  const FAM = 'rsint-family'
  const FAM2 = 'rsint-family-2'
  const PARENT = 'rsint-parent'
  const OTHER = 'rsint-other'
  const actor = { id: PARENT, name: 'Robin' }

  // A Monday; the template is due that day (date-only, UTC midnight).
  const NOW0 = new Date('2026-10-05T12:00:00Z')
  const NOW1 = new Date('2026-10-20T12:00:00Z')
  const day = (iso: string) => new Date(`${iso}T00:00:00Z`)

  async function cleanup() {
    await prisma.chore.deleteMany({ where: { family_id: { in: [FAM, FAM2] } } })
    await prisma.family.deleteMany({ where: { id: { in: [FAM, FAM2] } } })
    await prisma.user.deleteMany({ where: { id: { in: [PARENT, OTHER] } } })
  }

  async function weeklyTemplate(id: string, familyId: string, owner: string, due: Date) {
    await prisma.chore.create({
      data: {
        id,
        family_id: familyId,
        title: `Bins ${id}`,
        assigned_to: owner,
        created_by: owner,
        due_date: due,
        frequency: 'weekly',
        recurrence_id: id,
        is_template: true,
      },
    })
  }

  async function seriesDays(templateId: string): Promise<string[]> {
    const rows = await prisma.chore.findMany({
      where: { recurrence_id: templateId },
      orderBy: { due_date: 'asc' },
      select: { due_date: true },
    })
    return rows.map((r) => r.due_date.toISOString().slice(0, 10))
  }

  function post(body: unknown): any {
    return {
      method: 'POST',
      url: 'http://localhost/api/chores/create',
      nextUrl: new URL('http://localhost/api/chores/create'),
      headers: new Headers(),
      cookies: { get: (n: string) => (n === 'session_token' ? { value: `session:${PARENT}` } : undefined) },
      json: async () => body,
    }
  }

  function patch(body: unknown): any {
    return {
      method: 'PATCH',
      url: 'http://localhost/api/chores',
      nextUrl: new URL('http://localhost/api/chores'),
      headers: new Headers(),
      cookies: { get: (n: string) => (n === 'session_token' ? { value: `session:${PARENT}` } : undefined) },
      json: async () => body,
    }
  }

  beforeAll(async () => {
    const mod = await import('@/lib/prisma')
    if (!mod.prisma) throw new Error('Integration database is not configured')
    prisma = mod.prisma
    recurring = await import('@/lib/recurringChores')
    complete = await import('@/lib/chore-complete')
    route = await import('@/app/api/chores/route')
    createRoute = await import('@/app/api/chores/create/route')
    await cleanup()
    await prisma.family.createMany({
      data: [
        { id: FAM, name: 'Series home', invite_code: 'rsint-invite' },
        { id: FAM2, name: 'Series other', invite_code: 'rsint-invite-2' },
      ],
    })
    await prisma.user.createMany({
      data: [
        { id: PARENT, email: 'p@rsint.test', name: 'Robin', role: 'parent', family_id: FAM },
        { id: OTHER, email: 'o@rsint.test', name: 'Other', role: 'parent', family_id: FAM2 },
      ],
    })
  })

  beforeEach(async () => {
    await prisma.chore.deleteMany({ where: { family_id: { in: [FAM, FAM2] } } })
  })

  afterAll(cleanup)

  it.each([null, 'Evening reset'])('monthly series %s restores the template day after short months', async (routine) => {
    const id = 'rsint-monthly'
    await prisma.chore.create({ data: {
      id, family_id: FAM, title: 'Monthly reset', created_by: PARENT, assigned_to: PARENT,
      due_date: day('2026-01-31'), frequency: 'monthly', recurrence_id: id, is_template: true,
      routine, routine_order: routine ? 1 : null,
    } })
    await recurring.expandRecurringChores({ id, frequency: 'monthly' }, FAM, day('2026-01-31'))
    expect(await seriesDays(id)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31'])
    const copy = await complete.findHouseholdChore(prisma,
      (await prisma.chore.findFirstOrThrow({ where: { recurrence_id: id, due_date: day('2026-02-28') } })).id, FAM)
    expect(await complete.completeChore(prisma, copy!, actor, { now: day('2026-02-28') })).toBe(true)
    expect(await seriesDays(id)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'])
    expect(await complete.completeChore(prisma, copy!, actor, { now: day('2026-02-28') })).toBe(false)
    await recurring.expandRecurringChores({ id, frequency: 'monthly' }, FAM, day('2026-03-31'))
    expect(await seriesDays(id)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31'])
    const rows = await prisma.chore.findMany({ where: { recurrence_id: id } })
    expect(rows.every(row => row.routine === routine)).toBe(true)
    expect(await recurring.expandRecurringChores({ id, frequency: 'monthly' }, FAM2, day('2026-05-31'))).toBe(0)
  })

  it('tops up a stale January-31 series on March 1 without underfilling the monthly window', async () => {
    const id = 'rsint-stale-monthly'
    await prisma.chore.create({ data: {
      id, family_id: FAM, title: 'Monthly reset', created_by: PARENT, assigned_to: PARENT,
      due_date: day('2026-01-31'), frequency: 'monthly', recurrence_id: id, is_template: true,
    } })
    await recurring.expandRecurringChores({ id, frequency: 'monthly' }, FAM, day('2026-01-31'))
    expect(await recurring.expandRecurringChores({ id, frequency: 'monthly' }, FAM, day('2026-03-01'))).toBe(2)
    expect(await seriesDays(id)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31'])
    expect(await recurring.expandRecurringChores({ id, frequency: 'monthly' }, FAM, day('2026-03-01'))).toBe(0)
  })

  it('preserves old overflow occurrences and completed history while new dates use the original anchor', async () => {
    const id = 'rsint-old-monthly'
    await prisma.chore.create({ data: {
      id, family_id: FAM, title: 'Old monthly', created_by: PARENT, assigned_to: PARENT,
      due_date: day('2026-01-31'), frequency: 'monthly', recurrence_id: id, is_template: true,
      status: 'completed', completed_at: day('2026-01-31'),
    } })
    await prisma.chore.create({ data: {
      id: 'rsint-old-overflow', family_id: FAM, title: 'Old monthly', created_by: PARENT, assigned_to: PARENT,
      due_date: day('2026-03-03'), frequency: 'once', recurrence_id: id,
    } })
    await recurring.expandRecurringChores({ id, frequency: 'monthly' }, FAM, day('2026-03-03'))
    expect(await seriesDays(id)).toEqual(['2026-01-31', '2026-03-03', '2026-04-30', '2026-05-31'])
    const historical = await prisma.chore.findUniqueOrThrow({ where: { id } })
    expect(historical.status).toBe('completed')
    expect(historical.completed_at).toEqual(day('2026-01-31'))
    expect(await recurring.expandRecurringChores({ id, frequency: 'monthly' }, FAM, day('2026-03-03'))).toBe(0)
  })

  it('completing a generated copy extends the series; repeat completes add nothing', async () => {
    await weeklyTemplate('rsint-t1', FAM, PARENT, day('2026-10-05'))
    await recurring.expandRecurringChores({ id: 'rsint-t1', frequency: 'weekly' }, FAM, NOW0)
    expect(await seriesDays('rsint-t1')).toEqual(['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26'])

    // Two weeks on, someone ticks the 2026-10-19 copy (stored as 'once').
    const copy = await complete.findHouseholdChore(
      prisma,
      (await prisma.chore.findFirstOrThrow({ where: { recurrence_id: 'rsint-t1', due_date: day('2026-10-19') } })).id,
      FAM
    )
    expect(copy?.frequency).toBe('once')
    expect(await complete.completeChore(prisma, copy!, actor, { now: NOW1 })).toBe(true)
    const extended = await seriesDays('rsint-t1')
    expect(extended).toEqual([
      '2026-10-05',
      '2026-10-12',
      '2026-10-19',
      '2026-10-26',
      '2026-11-02',
      '2026-11-09',
      '2026-11-16',
    ])

    // The same tick again is a no-op, and ticking another copy the same day
    // finds the window already full: no duplicates.
    expect(await complete.completeChore(prisma, copy!, actor, { now: NOW1 })).toBe(false)
    const other = await complete.findHouseholdChore(
      prisma,
      (await prisma.chore.findFirstOrThrow({ where: { recurrence_id: 'rsint-t1', due_date: day('2026-10-26') } })).id,
      FAM
    )
    expect(await complete.completeChore(prisma, other!, actor, { now: NOW1 })).toBe(true)
    expect(await seriesDays('rsint-t1')).toEqual(extended)
  })

  it('the read-time top-up is idempotent and household-scoped', async () => {
    await weeklyTemplate('rsint-t2', FAM, PARENT, day('2026-10-05'))
    await weeklyTemplate('rsint-t3', FAM2, OTHER, day('2026-10-05'))
    await recurring.expandRecurringChores({ id: 'rsint-t2', frequency: 'weekly' }, FAM, NOW0)
    await recurring.expandRecurringChores({ id: 'rsint-t3', frequency: 'weekly' }, FAM2, NOW0)
    const otherBefore = await seriesDays('rsint-t3')

    expect(await recurring.topUpHouseholdSeries(FAM, NOW1)).toBe(3)
    const after = await seriesDays('rsint-t2')
    expect(after.slice(-3)).toEqual(['2026-11-02', '2026-11-09', '2026-11-16'])
    expect(await recurring.topUpHouseholdSeries(FAM, NOW1)).toBe(0)
    expect(await seriesDays('rsint-t2')).toEqual(after)
    // The other household's series is untouched.
    expect(await seriesDays('rsint-t3')).toEqual(otherBefore)

    // A template id from another household is never expanded for this one.
    const tx = (fn: (t: any) => Promise<number>) => prisma.$transaction((t) => fn(t))
    expect(await tx((t) => recurring.expandSeriesInTx(t, 'rsint-t3', FAM, NOW1))).toBe(0)
    expect(await seriesDays('rsint-t3')).toEqual(otherBefore)
  })

  it('PATCH once -> weekly starts a series; a copy ignores frequency; template -> once stops it', async () => {
    const today = new Date()
    const todayDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
    await prisma.chore.create({
      data: {
        id: 'rsint-p1',
        family_id: FAM,
        title: 'Water plants',
        assigned_to: PARENT,
        created_by: PARENT,
        due_date: todayDay,
      },
    })

    const res = await route.PATCH(patch({ choreId: 'rsint-p1', title: 'Water the plants', frequency: 'weekly' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.chore).toMatchObject({ id: 'rsint-p1', title: 'Water the plants', frequency: 'weekly' })
    const template = await prisma.chore.findUniqueOrThrow({ where: { id: 'rsint-p1' } })
    expect(template).toMatchObject({ is_template: true, recurrence_id: 'rsint-p1', frequency: 'weekly' })
    const copies = await prisma.chore.findMany({
      where: { recurrence_id: 'rsint-p1', NOT: { id: 'rsint-p1' } },
      orderBy: { due_date: 'asc' },
    })
    expect(copies).toHaveLength(3)
    expect(copies.every((c) => c.frequency === 'once' && !c.is_template && c.title === 'Water the plants')).toBe(true)

    // Saving again with the same frequency adds nothing.
    expect((await route.PATCH(patch({ choreId: 'rsint-p1', frequency: 'weekly' }))).status).toBe(200)
    expect(await prisma.chore.count({ where: { recurrence_id: 'rsint-p1' } })).toBe(4)

    // An older edit form posts a copy's own 'once' back: the series stays.
    expect((await route.PATCH(patch({ choreId: copies[0].id, frequency: 'once' }))).status).toBe(200)
    expect(await prisma.chore.findUniqueOrThrow({ where: { id: 'rsint-p1' } })).toMatchObject({
      is_template: true,
      frequency: 'weekly',
    })
    expect(await prisma.chore.count({ where: { recurrence_id: 'rsint-p1' } })).toBe(4)

    // Stop the series from the template: pending future copies go, a
    // completed one stays.
    await prisma.chore.update({ where: { id: copies[1].id }, data: { status: 'completed', completed_at: new Date() } })
    expect((await route.PATCH(patch({ choreId: 'rsint-p1', frequency: 'once' }))).status).toBe(200)
    expect(await prisma.chore.findUniqueOrThrow({ where: { id: 'rsint-p1' } })).toMatchObject({
      is_template: false,
      frequency: 'once',
    })
    const left = await prisma.chore.findMany({ where: { recurrence_id: 'rsint-p1' }, select: { id: true } })
    expect(left.map((c) => c.id).sort()).toEqual(['rsint-p1', copies[1].id].sort())

    // A stopped series is not extended by a completion or a top-up.
    const kept = await complete.findHouseholdChore(prisma, 'rsint-p1', FAM)
    await complete.completeChore(prisma, kept!, actor)
    expect(await recurring.topUpHouseholdSeries(FAM)).toBe(0)
    expect(await prisma.chore.count({ where: { recurrence_id: 'rsint-p1' } })).toBe(2)

    // Restarting from a copy with apply_to_series continues the same series.
    const restart = await route.PATCH(patch({ choreId: copies[1].id, frequency: 'weekly', apply_to_series: true }))
    expect(restart.status).toBe(200)
    expect(await prisma.chore.findUniqueOrThrow({ where: { id: 'rsint-p1' } })).toMatchObject({
      is_template: true,
      frequency: 'weekly',
    })
    expect(await prisma.chore.findUniqueOrThrow({ where: { id: copies[1].id } })).toMatchObject({ frequency: 'once' })
    // Template (today) and the kept copy (+14 days) count; one more (+21)
    // fits before the four-week horizon.
    expect(await prisma.chore.count({ where: { recurrence_id: 'rsint-p1' } })).toBe(3)
  })

  it('POST /api/chores/create writes the chore, its series link and copies together, or nothing', async () => {
    const chore = {
      title: 'Sweep porch',
      points: 10,
      assigned_to: PARENT,
      due_date: '2099-10-05',
      difficulty: 'easy',
      frequency: 'weekly',
    }
    const res = await createRoute.POST(post(chore))
    expect(res.status).toBe(200)
    const { chore: created } = await res.json()
    expect(await prisma.chore.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({
      is_template: true,
      recurrence_id: created.id,
    })
    expect(await seriesDays(created.id)).toEqual(['2099-10-05', '2099-10-12', '2099-10-19', '2099-10-26'])

    // The expansion fails: the request fails and nothing is left behind (no
    // "weekly" chore that would never repeat).
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const expand = jest.spyOn(recurring, 'expandSeriesInTx').mockRejectedValueOnce(new Error('expansion failed'))
    try {
      const failed = await createRoute.POST(post({ ...chore, title: 'Sweep porch again' }))
      expect(failed.status).toBe(500)
      expect(expand).toHaveBeenCalledTimes(1)
      expect(await prisma.chore.count({ where: { family_id: FAM, title: 'Sweep porch again' } })).toBe(0)
    } finally {
      jest.restoreAllMocks()
    }
  })
})
