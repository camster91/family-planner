// Beta usage counts (#287, PR101 D-6) against real Postgres: nothing is
// counted while a household is opted out (the default); concurrent increments
// sum exactly into one row per household, day and metric; rows older than 13
// months are pruned by the recorder; the first-chore bucket is recorded once
// and only for a household's real first chore; turning the counts off deletes
// the household's rows, also while increments race it; deleting the household
// cascades; and the scorecard query numbers households without selecting ids.
// Only the session token check and next/server are replaced. Opt-in like the
// other integration suites: RUN_DB_INTEGRATION=1 DATABASE_URL=... against a
// disposable database that `node scripts/migrate.js` has prepared.

jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('@/lib/session', () => ({
  // `session:<userId>` tokens; role and family always come from the real user row.
  verifySessionToken: async (token: string) => {
    if (!token?.startsWith('session:')) return null
    const { prisma } = require('@/lib/prisma')
    const u = await prisma.user.findUnique({ where: { id: token.slice(8) } })
    return u ? { userId: u.id, email: u.email, role: u.role, family_id: u.family_id, tv: u.token_version } : null
  },
  getTokenVersion: async () => 0,
}))

export {}

const describeWithDatabase = process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip

jest.setTimeout(60_000)

describeWithDatabase('beta usage counts against Postgres', () => {
  let prisma: NonNullable<typeof import('@/lib/prisma').prisma>
  let metrics: typeof import('@/lib/beta-metrics')
  let scorecard: typeof import('@/lib/beta-scorecard')
  let switchRoute: typeof import('@/app/api/family/beta-metrics/route')
  let choreRoute: typeof import('@/app/api/chores/create/route')
  let choreComplete: typeof import('@/lib/chore-complete')

  const FAM = 'betaint-family'
  const FAM2 = 'betaint-family-2'
  const FAM3 = 'betaint-family-3'
  const PARENT = 'betaint-parent'
  const CHILD = 'betaint-child'
  const PARENT2 = 'betaint-parent-2'
  const PARENT3 = 'betaint-parent-3'
  const NOW = new Date()
  const TODAY = NOW.toISOString().slice(0, 10)

  function request(as: string, path: string, body: unknown): any {
    const url = new URL(`http://localhost${path}`)
    return {
      method: 'PATCH',
      url: url.toString(),
      nextUrl: url,
      headers: new Headers(),
      cookies: { get: (n: string) => (n === 'session_token' ? { value: `session:${as}` } : undefined) },
      json: async () => body,
    }
  }

  async function rows(familyId: string) {
    return prisma.betaMetricDaily.findMany({
      where: { family_id: familyId },
      orderBy: [{ day: 'asc' }, { metric: 'asc' }],
    })
  }

  async function count(familyId: string, metric: string) {
    const r = await prisma.betaMetricDaily.findMany({ where: { family_id: familyId, metric } })
    return r.reduce((n, x) => n + x.count, 0)
  }

  async function setEnabled(familyId: string, on: boolean) {
    await prisma.family.update({ where: { id: familyId }, data: { beta_metrics_enabled: on } })
  }

  async function cleanup() {
    await prisma.family.deleteMany({ where: { id: { in: [FAM, FAM2, FAM3] } } })
    await prisma.user.deleteMany({ where: { id: { in: [PARENT, CHILD, PARENT2, PARENT3] } } })
  }

  beforeAll(async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const mod = await import('@/lib/prisma')
    if (!mod.prisma) throw new Error('Integration database is not configured')
    prisma = mod.prisma
    metrics = await import('@/lib/beta-metrics')
    scorecard = await import('@/lib/beta-scorecard')
    switchRoute = await import('@/app/api/family/beta-metrics/route')
    choreRoute = await import('@/app/api/chores/create/route')
    choreComplete = await import('@/lib/chore-complete')
    await cleanup()
    await prisma.family.createMany({
      data: [
        { id: FAM, name: 'Beta home', invite_code: 'betaint-invite' },
        { id: FAM2, name: 'Beta other', invite_code: 'betaint-invite-2' },
        { id: FAM3, name: 'Beta late', invite_code: 'betaint-invite-3' },
      ],
    })
    await prisma.user.createMany({
      data: [
        { id: PARENT, email: 'p@betaint.test', name: 'Robin', role: 'parent', family_id: FAM },
        { id: CHILD, email: 'c@betaint.test', name: 'Kit', role: 'child', family_id: FAM },
        // Household 2 registered an hour ago: its first chore is "slow".
        {
          id: PARENT2, email: 'p2@betaint.test', name: 'Sam', role: 'parent', family_id: FAM2,
          created_at: new Date(Date.now() - 60 * 60 * 1000),
        },
        { id: PARENT3, email: 'p3@betaint.test', name: 'Lee', role: 'parent', family_id: FAM3 },
      ],
    })
  })

  afterAll(async () => {
    await cleanup()
    jest.restoreAllMocks()
  })

  it('a new household is opted out, and nothing is counted while it is', async () => {
    const fam = await prisma.family.findUniqueOrThrow({ where: { id: FAM }, select: { beta_metrics_enabled: true } })
    expect(fam.beta_metrics_enabled).toBe(false)
    await metrics.recordBetaMetric(prisma, FAM, 'event_created')
    expect(await rows(FAM)).toEqual([])
  })

  it('concurrent increments sum exactly into one row per household, day and metric', async () => {
    await setEnabled(FAM, true)
    await setEnabled(FAM2, true)
    await Promise.all([
      ...Array.from({ length: 40 }, () => metrics.recordBetaMetric(prisma, FAM, 'chore_completed')),
      ...Array.from({ length: 10 }, () => metrics.recordBetaMetric(prisma, FAM, 'reward_claimed')),
      ...Array.from({ length: 7 }, () => metrics.recordBetaMetric(prisma, FAM2, 'chore_completed')),
    ])
    const mine = await rows(FAM)
    expect(mine.map((r) => [r.metric, r.count])).toEqual([
      ['chore_completed', 40],
      ['reward_claimed', 10],
    ])
    expect(mine.every((r) => r.day.toISOString().slice(0, 10) === TODAY)).toBe(true)
    expect(await count(FAM2, 'chore_completed')).toBe(7)
    // Only the four columns exist: no user, text or content anywhere.
    const columns: Array<{ column_name: string }> = await prisma.$queryRawUnsafe(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'BetaMetricDaily' ORDER BY ordinal_position`
    )
    expect(columns.map((c) => c.column_name)).toEqual(['family_id', 'day', 'metric', 'count'])
  })

  it('prunes the household’s rows older than 13 months when it records, and keeps newer ones', async () => {
    const old = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() - 14, 1))
    const kept = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() - 12, 1))
    await prisma.betaMetricDaily.createMany({
      data: [
        { family_id: FAM, day: old, metric: 'event_created', count: 3 },
        { family_id: FAM, day: kept, metric: 'event_created', count: 2 },
        { family_id: FAM2, day: old, metric: 'event_created', count: 5 },
      ],
    })
    await metrics.recordBetaMetric(prisma, FAM, 'event_created')
    const days = (await prisma.betaMetricDaily.findMany({ where: { family_id: FAM, metric: 'event_created' } }))
      .map((r) => r.day.toISOString().slice(0, 10))
      .sort()
    expect(days).toEqual([kept.toISOString().slice(0, 10), TODAY])
    // Another household's old row waits for that household's own next count.
    expect(await count(FAM2, 'event_created')).toBe(5)
    await prisma.betaMetricDaily.deleteMany({ where: { family_id: FAM2, metric: 'event_created' } })
  })

  it('assigning the first chore through the route records the assignment and one "within 10 minutes" bucket', async () => {
    const create = (title: string) =>
      choreRoute.POST(
        request(PARENT, '/api/chores/create', { title, assigned_to: CHILD, due_date: TODAY, points: 5 }) as any
      )
    expect((await create('Feed the cat')).status).toBe(200)
    expect((await create('Water plants')).status).toBe(200)
    expect(await count(FAM, 'chore_assigned')).toBe(2)
    expect(await count(FAM, 'first_chore_within_10m')).toBe(1)
    expect(await count(FAM, 'first_chore_after_10m')).toBe(0)

    // Completing it (the shared helper, person and tablet alike) counts after the commit.
    const chore = await prisma.chore.findFirstOrThrow({ where: { family_id: FAM, title: 'Feed the cat' } })
    const selected = await choreComplete.findHouseholdChore(prisma, chore.id, FAM)
    expect(await choreComplete.completeChore(prisma, selected!, { id: CHILD, name: 'Kit' })).toBe(true)
    expect(await choreComplete.completeChore(prisma, selected!, { id: CHILD, name: 'Kit' })).toBe(false)
    expect(await count(FAM, 'chore_completed')).toBe(41)
  })

  it('a household that registered an hour before its first chore gets the "after 10 minutes" bucket', async () => {
    const chore = await prisma.chore.create({
      data: { family_id: FAM2, title: 'Tidy', assigned_to: PARENT2, due_date: new Date(`${TODAY}T00:00:00Z`), created_by: PARENT2 },
    })
    await metrics.recordChoreAssigned(prisma, FAM2, chore)
    await metrics.recordChoreAssigned(prisma, FAM2, chore)
    expect(await count(FAM2, 'first_chore_after_10m')).toBe(1)
    expect(await count(FAM2, 'first_chore_within_10m')).toBe(0)
  })

  it('a household that opts in after its first chore never gets a bucket (a late opt-in is not "slow")', async () => {
    const due = new Date(`${TODAY}T00:00:00Z`)
    await prisma.chore.create({ data: { family_id: FAM3, title: 'Early', assigned_to: PARENT3, due_date: due, created_by: PARENT3 } })
    await setEnabled(FAM3, true)
    const later = await prisma.chore.create({
      data: { family_id: FAM3, title: 'Later', assigned_to: PARENT3, due_date: due, created_by: PARENT3 },
    })
    await metrics.recordChoreAssigned(prisma, FAM3, later)
    expect(await count(FAM3, 'chore_assigned')).toBe(1)
    expect(await count(FAM3, 'first_chore_within_10m')).toBe(0)
    expect(await count(FAM3, 'first_chore_after_10m')).toBe(0)
  })

  it('the scorecard query numbers households in the database and returns no ids', async () => {
    const result: Array<Record<string, unknown>> = await prisma.$queryRawUnsafe(
      scorecard.SCORECARD_ROWS_SQL,
      scorecard.windowStartDay(TODAY)
    )
    expect(result.length).toBeGreaterThan(0)
    for (const row of result) {
      expect(Object.keys(row).sort()).toEqual(['count', 'day', 'household', 'metric'])
      expect(typeof row.household).toBe('number')
    }
    expect(JSON.stringify(result)).not.toContain('betaint')
    const card = scorecard.computeScorecard({ rows: result as any, householdsOptedIn: 3 }, TODAY)
    expect(card.householdsReporting).toBeGreaterThanOrEqual(3)
  })

  it('a parent turning it off deletes only that household’s counts, even with increments racing it', async () => {
    const before2 = await rows(FAM2)
    expect(before2.length).toBeGreaterThan(0)
    const [res] = await Promise.all([
      switchRoute.PATCH(request(PARENT, '/api/family/beta-metrics', { enabled: false }) as any),
      ...Array.from({ length: 20 }, () => metrics.recordBetaMetric(prisma, FAM, 'meal_planned')),
    ])
    expect(res.status).toBe(200)
    // Whichever order they ran in, nothing is left once the switch is off.
    expect(await rows(FAM)).toEqual([])
    await metrics.recordBetaMetric(prisma, FAM, 'meal_planned')
    expect(await rows(FAM)).toEqual([])
    expect(await rows(FAM2)).toEqual(before2)
    const audit = await prisma.auditLog.findMany({ where: { family_id: FAM, action: 'beta_metrics.turned_off' } })
    expect(audit).toHaveLength(1)
  })

  it('deleting the household deletes its counts (ON DELETE CASCADE)', async () => {
    expect((await rows(FAM2)).length).toBeGreaterThan(0)
    await prisma.chore.deleteMany({ where: { family_id: FAM2 } })
    await prisma.user.deleteMany({ where: { id: PARENT2 } })
    await prisma.family.delete({ where: { id: FAM2 } })
    const left: Array<{ n: number }> = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS n FROM "BetaMetricDaily" WHERE "family_id" = $1`,
      FAM2
    )
    expect(left[0].n).toBe(0)
  })
})
