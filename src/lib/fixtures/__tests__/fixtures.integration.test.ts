/**
 * Runs seed/reset against a real database. Skipped unless RUN_DB_INTEGRATION=1.
 * The fixture target guard still applies, so FIXTURES_ALLOW=1 and a loopback
 * or disposable DATABASE_URL are also required.
 */
import { hashPassword, verifyPassword } from '@/lib/auth'
import { assertFixtureTargetAllowed } from '../guard'
import { buildFixtureDataset, FIXTURE_IDS, FIXTURE_PASSWORD } from '../dataset'
import { FixtureConflictError, resetFixtures, seedFixtures } from '../seed'

const describeWithDatabase = process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip

jest.setTimeout(120_000)

describeWithDatabase('fixture seed/reset against a database', () => {
  let prisma: NonNullable<typeof import('@/lib/prisma').prisma>
  const ds = buildFixtureDataset()
  const pw = { password: FIXTURE_PASSWORD, hashPassword, verifyPassword }
  const A = FIXTURE_IDS.familyA

  // Non-fixture rows. `fxZ...` also proves the `fx_` prefix match treats `_`
  // literally (an unescaped LIKE 'fx_%' would match these ids).
  const outsiderFamily = 'fxZoutsider-family'
  const outsiderUser = 'fxZoutsider-user'

  async function snapshot() {
    const q = (table: string) =>
      prisma.$queryRawUnsafe<Array<{ j: string }>>(
        `SELECT row_to_json(x)::text AS j FROM "${table}" x WHERE id LIKE 'fx\\_%' ORDER BY id`
      )
    const out: Record<string, string[]> = {}
    for (const t of ['Family', 'User', 'Event', 'Chore', 'Reward', 'List', 'ListItem']) {
      out[t] = (await q(t)).map((r) => r.j)
    }
    return out
  }

  beforeAll(async () => {
    assertFixtureTargetAllowed(process.env)
    const mod = await import('@/lib/prisma')
    if (!mod.prisma) throw new Error('Integration database is not configured')
    prisma = mod.prisma
    await resetFixtures(prisma, ds)
    await prisma.family.deleteMany({ where: { id: outsiderFamily } })
    await prisma.user.deleteMany({ where: { id: outsiderUser } })
    await prisma.family.create({ data: { id: outsiderFamily, name: 'Outsider', invite_code: 'outsider-invite' } })
    await prisma.user.create({
      data: { id: outsiderUser, email: 'outsider@example.test', name: 'Outsider', role: 'parent', family_id: outsiderFamily },
    })
    await prisma.chore.create({
      data: {
        id: 'fxZoutsider-chore',
        family_id: outsiderFamily,
        title: 'Outsider chore',
        assigned_to: outsiderUser,
        created_by: outsiderUser,
        due_date: new Date('2026-01-05T00:00:00Z'),
      },
    })
  })

  afterAll(async () => {
    if (!prisma) return
    await resetFixtures(prisma, ds).catch(() => {})
    await prisma.family.deleteMany({ where: { id: outsiderFamily } })
    await prisma.user.deleteMany({ where: { id: outsiderUser } })
    await prisma.$disconnect()
  })

  it('seeding twice yields identical rows and keeps passwords valid', async () => {
    const first = await seedFixtures(prisma, ds, pw)
    expect(first.passwordsRehashed).toBe(ds.users.length)
    const s1 = await snapshot()
    const second = await seedFixtures(prisma, ds, pw)
    expect(second.passwordsRehashed).toBe(0)
    expect(await snapshot()).toEqual(s1)
    expect(s1.User).toHaveLength(ds.users.length)
    expect(s1.Chore).toHaveLength(ds.chores.length)

    const parent = await prisma.user.findUniqueOrThrow({ where: { id: A.parent } })
    expect(await verifyPassword(FIXTURE_PASSWORD, parent.password!)).toBe(true)
  })

  it('reconciles drift, prunes stale fx_ rows and leaves app-created rows alone', async () => {
    await prisma.chore.update({ where: { id: A.chore }, data: { title: 'Edited during a test', status: 'completed' } })
    await prisma.user.update({ where: { id: A.teen }, data: { password: await hashPassword('changed-in-test') } })
    await prisma.event.create({
      data: {
        id: 'fx_event_a_stale',
        family_id: A.family,
        created_by: A.parent,
        title: 'Stale fixture',
        start_time: new Date(),
        end_time: new Date(),
      },
    })
    await prisma.event.create({
      data: {
        id: 'fxZapp-created-event',
        family_id: A.family,
        created_by: A.parent,
        title: 'Created by the app',
        start_time: new Date(),
        end_time: new Date(),
      },
    })

    const summary = await seedFixtures(prisma, ds, pw)
    expect(summary.pruned.events).toBe(1)
    expect(summary.passwordsRehashed).toBe(1)
    expect(await prisma.chore.findUniqueOrThrow({ where: { id: A.chore } })).toMatchObject({
      title: 'Take out recycling',
      status: 'pending',
    })
    expect(await prisma.event.findUnique({ where: { id: 'fx_event_a_stale' } })).toBeNull()
    expect(await prisma.event.findUnique({ where: { id: 'fxZapp-created-event' } })).not.toBeNull()
  })

  it('refuses to reset when a non-fixture user sits in a fixture family', async () => {
    await prisma.user.update({ where: { id: outsiderUser }, data: { family_id: A.family } })
    try {
      await expect(resetFixtures(prisma, ds)).rejects.toBeInstanceOf(FixtureConflictError)
      expect(await prisma.family.findUnique({ where: { id: A.family } })).not.toBeNull()
    } finally {
      await prisma.user.update({ where: { id: outsiderUser }, data: { family_id: outsiderFamily } })
    }
  })

  it('refuses to seed when a non-fixture user owns a fixture email', async () => {
    await resetFixtures(prisma, ds)
    await prisma.user.update({ where: { id: outsiderUser }, data: { email: ds.users[0].email } })
    try {
      await expect(seedFixtures(prisma, ds, pw)).rejects.toBeInstanceOf(FixtureConflictError)
      expect(await prisma.family.count({ where: { id: { in: ds.families.map((f) => f.id) } } })).toBe(0)
    } finally {
      await prisma.user.update({ where: { id: outsiderUser }, data: { email: 'outsider@example.test' } })
    }
  })

  it('reset removes fixture rows (and app rows inside fixture families) but nothing else', async () => {
    await seedFixtures(prisma, ds, pw)
    const outsidersBefore = await prisma.chore.count({ where: { family_id: outsiderFamily } })
    const result = await resetFixtures(prisma, ds)
    expect(result).toEqual({ families: ds.families.length, users: ds.users.length })
    const after = await snapshot()
    for (const rows of Object.values(after)) expect(rows).toEqual([])
    expect(await prisma.event.count({ where: { family_id: A.family } })).toBe(0)
    expect(await prisma.user.findUnique({ where: { id: outsiderUser } })).not.toBeNull()
    expect(await prisma.chore.count({ where: { family_id: outsiderFamily } })).toBe(outsidersBefore)
    expect(await resetFixtures(prisma, ds)).toEqual({ families: 0, users: 0 })
  })
})
