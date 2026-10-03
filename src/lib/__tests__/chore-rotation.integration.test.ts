// Take turns (O-39) against real Postgres: create -> complete -> refill keeps
// the order, a hand reassign does not move it, a repeated top-up adds
// nothing, another household's member is refused, and removing a member
// (O-34) drops them from every rotation in the same transaction. Opt-in like
// the other integration suites: RUN_DB_INTEGRATION=1 DATABASE_URL=... against
// a disposable database prepared by `node scripts/migrate.js`.

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

describeWithDatabase('take turns against Postgres', () => {
  let prisma: NonNullable<typeof import('@/lib/prisma').prisma>
  let recurring: typeof import('@/lib/recurringChores')
  let complete: typeof import('@/lib/chore-complete')
  let removal: typeof import('@/lib/member-removal')
  let route: typeof import('@/app/api/chores/route')
  let createRoute: typeof import('@/app/api/chores/create/route')

  const FAM = 'rotint-family'
  const FAM2 = 'rotint-family-2'
  const SAM = 'rotint-sam'
  const ALEX = 'rotint-alex'
  const JO = 'rotint-jo'
  const OTHER = 'rotint-other'
  const USERS = [SAM, ALEX, JO, OTHER]

  const DAY = 24 * 60 * 60 * 1000
  const now0 = new Date()
  const T = new Date(Date.UTC(now0.getUTCFullYear(), now0.getUTCMonth(), now0.getUTCDate()))
  const at = (days: number) => new Date(T.getTime() + days * DAY + 12 * 60 * 60 * 1000)
  const iso = (d: Date) => d.toISOString().slice(0, 10)

  async function cleanup() {
    await prisma.chore.deleteMany({ where: { family_id: { in: [FAM, FAM2] } } })
    await prisma.auditLog.deleteMany({ where: { family_id: { in: [FAM, FAM2] } } })
    await prisma.family.deleteMany({ where: { id: { in: [FAM, FAM2] } } })
    await prisma.user.deleteMany({ where: { id: { in: USERS } } })
  }

  function request(method: 'POST' | 'PATCH', path: string, body: unknown, as = SAM): any {
    return {
      method,
      url: `http://localhost${path}`,
      nextUrl: new URL(`http://localhost${path}`),
      headers: new Headers(),
      cookies: { get: (n: string) => (n === 'session_token' ? { value: `session:${as}` } : undefined) },
      json: async () => body,
    }
  }

  async function series(templateId: string) {
    return prisma.chore.findMany({
      where: { recurrence_id: templateId },
      orderBy: { due_date: 'asc' },
      select: { id: true, due_date: true, assigned_to: true, rotation_index: true, status: true },
    })
  }
  const who = async (templateId: string) => (await series(templateId)).map((c) => c.assigned_to)

  async function createRotating(title: string, rotation: string[]) {
    const res = await createRoute.POST(
      request('POST', '/api/chores/create', {
        title,
        due_date: iso(T),
        frequency: 'weekly',
        rotation,
      })
    )
    const body = await res.json()
    return { status: res.status, body }
  }

  beforeAll(async () => {
    const mod = await import('@/lib/prisma')
    if (!mod.prisma) throw new Error('Integration database is not configured')
    prisma = mod.prisma
    recurring = await import('@/lib/recurringChores')
    complete = await import('@/lib/chore-complete')
    removal = await import('@/lib/member-removal')
    route = await import('@/app/api/chores/route')
    createRoute = await import('@/app/api/chores/create/route')
    await cleanup()
    await prisma.family.createMany({
      data: [
        { id: FAM, name: 'Turns home', invite_code: 'rotint-invite' },
        { id: FAM2, name: 'Turns other', invite_code: 'rotint-invite-2' },
      ],
    })
    await prisma.user.createMany({
      data: [
        { id: SAM, email: 'sam@rotint.test', name: 'Sam', role: 'parent', family_id: FAM },
        { id: ALEX, email: 'alex@rotint.test', name: 'Alex', role: 'teen', family_id: FAM },
        { id: JO, email: 'jo@rotint.test', name: 'Jo', role: 'child', family_id: FAM },
        { id: OTHER, email: 'other@rotint.test', name: 'Other', role: 'parent', family_id: FAM2 },
      ],
    })
  })

  afterAll(cleanup)

  it('create -> hand reassign -> complete -> refill -> remove a member', async () => {
    // Create: the template is the first turn; the window follows the order.
    const created = await createRotating('Dishes', [SAM, ALEX, JO])
    expect(created.status).toBe(200)
    const id = created.body.chore.id as string
    expect(await who(id)).toEqual([SAM, ALEX, JO, SAM])
    expect((await series(id)).map((c) => c.rotation_index)).toEqual([0, 1, 2, 0])

    // A parent hands Jo's turn (T+14) to Sam: only that row changes.
    const josTurn = (await series(id))[2]
    const patched = await route.PATCH(request('PATCH', '/api/chores', { choreId: josTurn.id, assigned_to: SAM }))
    expect(patched.status).toBe(200)

    // A week on, Jo ticks Alex's chore (T+7): the series refills, in order,
    // after the latest place (Sam, place 0) -> Alex, Jo.
    const alexs = await complete.findHouseholdChore(prisma, (await series(id))[1].id, FAM)
    expect(await complete.completeChore(prisma, alexs!, { id: JO, name: 'Jo' }, { now: at(8) })).toBe(true)
    expect(await who(id)).toEqual([SAM, ALEX, SAM, SAM, ALEX, JO])
    expect((await series(id)).map((c) => c.rotation_index)).toEqual([0, 1, 2, 0, 1, 2])

    // Re-running the top-up adds nothing and moves nobody.
    const before = await series(id)
    expect(await recurring.topUpHouseholdSeries(FAM, at(8))).toBe(0)
    expect(await series(id)).toEqual(before)

    // A second series that drops to one person when Alex leaves.
    const bins = await createRotating('Bins', [ALEX, JO])
    expect(bins.status).toBe(200)
    const binsId = bins.body.chore.id as string

    // Remove Alex (O-34): in the same transaction they leave both rotations.
    await removal.removeHouseholdMember({ actorId: SAM, familyId: FAM, targetId: ALEX })
    const dishes = await prisma.chore.findUniqueOrThrow({ where: { id }, select: { rotation_member_ids: true } })
    expect(dishes.rotation_member_ids).toEqual([SAM, JO])
    const binsTemplate = await prisma.chore.findUniqueOrThrow({ where: { id: binsId }, select: { rotation_member_ids: true } })
    expect(binsTemplate.rotation_member_ids).toEqual([JO])
    // Alex's open chores went to the removing parent (O-34); done ones keep Alex's name.
    const afterRemoval = await series(id)
    expect(afterRemoval.filter((c) => c.status === 'pending').every((c) => c.assigned_to !== ALEX)).toBe(true)
    expect(afterRemoval[1]).toMatchObject({ assigned_to: ALEX, status: 'completed' })

    // The order carries on without Alex: latest was Jo, so Sam, then Jo.
    await recurring.topUpHouseholdSeries(FAM, at(15))
    await recurring.topUpHouseholdSeries(FAM, at(22))
    const dishesNow = await series(id)
    expect(dishesNow.slice(6).map((c) => [iso(c.due_date), c.assigned_to])).toEqual([
      [iso(new Date(T.getTime() + 42 * DAY)), SAM],
      [iso(new Date(T.getTime() + 49 * DAY)), JO],
    ])
    // Bins now goes to Jo every time.
    const binsNow = await series(binsId)
    expect(binsNow.slice(4).map((c) => c.assigned_to).every((p) => p === JO)).toBe(true)
    expect(binsNow.length).toBeGreaterThan(4)
  })

  it('refuses a member of another household, and writes nothing', async () => {
    const res = await createRotating('Laundry', [SAM, OTHER])
    expect(res.status).toBe(400)
    expect(await prisma.chore.count({ where: { family_id: FAM, title: 'Laundry' } })).toBe(0)

    const ok = await createRotating('Laundry', [SAM, JO])
    expect(ok.status).toBe(200)
    const patch = await route.PATCH(
      request('PATCH', '/api/chores', { choreId: ok.body.chore.id, rotation: [JO, OTHER] })
    )
    expect(patch.status).toBe(400)
    const t = await prisma.chore.findUniqueOrThrow({ where: { id: ok.body.chore.id }, select: { rotation_member_ids: true } })
    expect(t.rotation_member_ids).toEqual([SAM, JO])

    // The other household's parent cannot change it either.
    const foreign = await route.PATCH(
      request('PATCH', '/api/chores', { choreId: ok.body.chore.id, rotation: null }, OTHER)
    )
    expect([403, 404]).toContain(foreign.status)
  })

  it('a chore with no rotation keeps the empty default (older rows read the same)', async () => {
    await prisma.chore.create({
      data: { id: 'rotint-plain', family_id: FAM, title: 'Plain', assigned_to: SAM, created_by: SAM, due_date: T },
    })
    const row = await prisma.chore.findUniqueOrThrow({
      where: { id: 'rotint-plain' },
      select: { rotation_member_ids: true, rotation_index: true },
    })
    expect(row).toEqual({ rotation_member_ids: [], rotation_index: null })
  })
})
