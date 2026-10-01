// POST /api/projects/[id]/send-to-calendar against real Postgres: two sends
// at once (a double tap) create each task's event once. The read of what is
// already sent and the creates run in one transaction under a lock on the
// project row. Opt-in like the other integration suites:
// RUN_DB_INTEGRATION=1 DATABASE_URL=... against a disposable database that
// `node scripts/migrate.js` has prepared.

jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('@/lib/feature-gate-server', () => ({ featureGate: async () => null }))
jest.mock('@/lib/session', () => ({
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

describeWithDatabase('send to calendar against Postgres', () => {
  let prisma: NonNullable<typeof import('@/lib/prisma').prisma>
  let route: typeof import('../[id]/send-to-calendar/route')

  const FAM = 'stcint-family'
  const PARENT = 'stcint-parent'
  const PROJECT = 'stcint-project'

  function post(): any {
    const url = new URL(`http://localhost/api/projects/${PROJECT}/send-to-calendar`)
    return {
      method: 'POST',
      url: url.toString(),
      nextUrl: url,
      headers: new Headers(),
      cookies: { get: (n: string) => (n === 'session_token' ? { value: `session:${PARENT}` } : undefined) },
      json: async () => ({ timeZone: 'UTC' }),
    }
  }

  async function cleanup() {
    await prisma.event.deleteMany({ where: { family_id: FAM } })
    await prisma.project.deleteMany({ where: { family_id: FAM } })
    await prisma.family.deleteMany({ where: { id: FAM } })
    await prisma.user.deleteMany({ where: { id: PARENT } })
  }

  beforeAll(async () => {
    const mod = await import('@/lib/prisma')
    if (!mod.prisma) throw new Error('Integration database is not configured')
    prisma = mod.prisma
    route = await import('../[id]/send-to-calendar/route')
    await cleanup()
    await prisma.family.create({ data: { id: FAM, name: 'STC', invite_code: 'stcint-invite' } })
    await prisma.user.create({
      data: { id: PARENT, email: 'p@stcint.test', name: 'Robin', role: 'parent', family_id: FAM },
    })
    await prisma.project.create({ data: { id: PROJECT, family_id: FAM, name: 'Garage', created_by: PARENT } })
    await prisma.projectTask.createMany({
      data: [1, 2, 3].map((n) => ({
        id: `stcint-task-${n}`,
        project_id: PROJECT,
        title: `Task ${n}`,
        due_date: new Date(`2026-10-1${n}T00:00:00Z`),
      })),
    })
  })

  beforeEach(async () => {
    await prisma.event.deleteMany({ where: { family_id: FAM } })
  })

  afterAll(cleanup)

  it('two concurrent sends create each event once', async () => {
    const params = () => ({ params: Promise.resolve({ id: PROJECT }) })
    const results = await Promise.all([route.POST(post(), params()), route.POST(post(), params())])
    expect(results.map((r: any) => r.status)).toEqual([200, 200])
    const bodies = await Promise.all(results.map((r: any) => r.json()))
    expect(bodies.map((b) => b.eventsCreated).sort()).toEqual([0, 3])

    const events = await prisma.event.findMany({ where: { family_id: FAM, project_id: PROJECT } })
    expect(events).toHaveLength(3)
    expect(new Set(events.map((e) => e.source_uid)).size).toBe(3)
  })

  it('a send waits for another holding the project lock, then sends only what is left', async () => {
    const { lockProjectRow, projectTaskUid } = await import('@/lib/project-calendar')
    let release!: () => void
    let locked!: () => void
    const isLocked = new Promise<void>((resolve) => (locked = resolve))
    // Another send in flight: holds the lock and has created task 1's event.
    const held = prisma.$transaction(
      async (tx) => {
        await lockProjectRow(tx, PROJECT)
        await tx.event.create({
          data: {
            family_id: FAM,
            title: 'Task 1',
            start_time: new Date('2026-10-11T00:00:00Z'),
            end_time: new Date('2026-10-11T23:59:00Z'),
            event_type: 'other',
            is_task: true,
            project_id: PROJECT,
            source_uid: projectTaskUid('stcint-task-1'),
            created_by: PARENT,
          },
        })
        locked()
        await new Promise<void>((resolve) => (release = resolve))
      },
      { timeout: 20_000 }
    )
    await isLocked

    let done = false
    const send = route.POST(post(), { params: Promise.resolve({ id: PROJECT }) }).then((res: any) => {
      done = true
      return res
    })
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(done).toBe(false)

    release()
    await held
    const body = await (await send).json()
    expect(body.eventsCreated).toBe(2)
    expect(await prisma.event.count({ where: { family_id: FAM, project_id: PROJECT } })).toBe(3)
  })
})
