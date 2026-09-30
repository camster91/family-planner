// Legacy page-view retention against real Postgres (#136, #140): the prune
// filter (prefix match minus real household types, household scope, cutoff)
// runs through the real Prisma client. Opt-in like the other integration
// suites: RUN_DB_INTEGRATION=1 DATABASE_URL=... against a disposable database
// that `node scripts/migrate.js` has prepared.

export {}

const describeWithDatabase = process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip

jest.setTimeout(60_000)

describeWithDatabase('legacy analytics prune against Postgres', () => {
  let prisma: NonNullable<typeof import('@/lib/prisma').prisma>
  let lib: typeof import('../legacy-analytics')

  const FAM = 'legacyan-family'
  const FAM2 = 'legacyan-family-2'
  const U1 = 'legacyan-user'
  const U2 = 'legacyan-user-2'
  const NOW = new Date('2026-09-30T12:00:00Z')
  const DAY = 86_400_000

  async function cleanup() {
    await prisma.family.deleteMany({ where: { id: { in: [FAM, FAM2] } } })
    await prisma.user.deleteMany({ where: { id: { in: [U1, U2] } } })
  }

  beforeAll(async () => {
    const mod = await import('@/lib/prisma')
    if (!mod.prisma) throw new Error('Integration database is not configured')
    prisma = mod.prisma
    lib = await import('../legacy-analytics')
    await cleanup()
    await prisma.family.createMany({
      data: [
        { id: FAM, name: 'Legacy home', invite_code: 'legacyan-invite' },
        { id: FAM2, name: 'Legacy other', invite_code: 'legacyan-invite-2' },
      ],
    })
    await prisma.$executeRawUnsafe(
      `INSERT INTO "User" (id, email, name, role, family_id) VALUES
        ($1, 'a@legacyan.test', 'Ash', 'parent', $3),
        ($2, 'b@legacyan.test', 'Bo', 'parent', $4)`,
      U1,
      U2,
      FAM,
      FAM2
    )
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  it('deletes only old legacy rows of the one household', async () => {
    const old = new Date(NOW.getTime() - lib.LEGACY_ANALYTICS_RETENTION_MS - DAY)
    const recent = new Date(NOW.getTime() - 10 * DAY)
    const row = (id: string, family_id: string, user_id: string, type: string, created_at: Date) => ({
      id,
      family_id,
      user_id,
      type,
      title: type,
      created_at,
    })
    await prisma.activity.createMany({
      data: [
        row('legacyan-old-view', FAM, U1, 'event_page_view', old),
        row('legacyan-old-click', FAM, U1, 'event_cta_click', old),
        row('legacyan-new-view', FAM, U1, 'event_page_view', recent),
        row('legacyan-old-created', FAM, U1, 'event_created', old),
        row('legacyan-old-imported', FAM, U1, 'events_imported', old),
        row('legacyan-old-chore', FAM, U1, 'chore_completed', old),
        row('legacyan-other-old-view', FAM2, U2, 'event_page_view', old),
      ],
    })

    expect(await lib.pruneLegacyAnalytics(prisma, FAM, NOW)).toBe(2)

    const left = (await prisma.activity.findMany({ where: { id: { startsWith: 'legacyan-' } }, select: { id: true } }))
      .map((r) => r.id)
      .sort()
    expect(left).toEqual([
      'legacyan-new-view',
      'legacyan-old-chore',
      'legacyan-old-created',
      'legacyan-old-imported',
      'legacyan-other-old-view',
    ])
  })
})
