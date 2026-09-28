// POST /api/calendar/import-suggestions/commit and /undo against real Postgres
// (#270, #277 review): the transaction, the IdempotencyRecord replay (and a
// concurrent double submit creating one batch), the crash-takeover lookup by
// the activity row's metadata, and that the signed undo removes only that
// import, never a hand-made event or another household's rows.
// Only the session token check and next/server are replaced.
// Opt-in like the other integration suites: RUN_DB_INTEGRATION=1
// DATABASE_URL=... against a disposable database that `node scripts/migrate.js`
// has prepared.

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

export {}

const describeWithDatabase = process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip

jest.setTimeout(60_000)

describeWithDatabase('event import commit and undo against Postgres', () => {
  let prisma: NonNullable<typeof import('@/lib/prisma').prisma>
  let commit: typeof import('../commit/route')
  let undo: typeof import('../undo/route')
  let commitLib: typeof import('@/lib/event-import-commit')

  const FAM = 'eiint-family'
  const FAM2 = 'eiint-family-2'
  const PARENT = 'eiint-parent'
  const TEEN = 'eiint-teen'
  const OTHER = 'eiint-other'

  let keySeq = 0
  const newKey = () => `eiint-key-${Date.now().toString(36)}-${(keySeq++).toString().padStart(6, '0')}`

  const EVENTS = [
    { title: 'EIINT Picture day', start_time: '2026-10-02T04:00:00.000Z', end_time: '2026-10-03T03:59:00.000Z' },
    { title: 'EIINT Bake sale', start_time: '2026-10-09T19:30:00.000Z', end_time: '2026-10-09T21:00:00.000Z', location: 'Gym' },
  ]

  function request(as: string, body?: unknown, key?: string): any {
    const url = new URL('http://localhost/api/test')
    return {
      url: url.toString(),
      nextUrl: url,
      headers: new Headers(key ? { 'Idempotency-Key': key } : {}),
      cookies: { get: (n: string) => (n === 'session_token' ? { value: `session:${as}` } : undefined) },
      json: async () => body,
    }
  }

  const count = (family = FAM) => prisma.event.count({ where: { family_id: family, title: { startsWith: 'EIINT' } } })

  async function cleanup() {
    await prisma.idempotencyRecord.deleteMany({ where: { user_id: { in: [PARENT, TEEN, OTHER] } } })
    await prisma.family.deleteMany({ where: { id: { in: [FAM, FAM2] } } })
    await prisma.user.deleteMany({ where: { id: { in: [PARENT, TEEN, OTHER] } } })
  }

  beforeAll(async () => {
    const mod = await import('@/lib/prisma')
    if (!mod.prisma) throw new Error('Integration database is not configured')
    prisma = mod.prisma
    commit = await import('../commit/route')
    undo = await import('../undo/route')
    commitLib = await import('@/lib/event-import-commit')
    await cleanup()
    await prisma.family.createMany({
      data: [
        { id: FAM, name: 'EI', invite_code: 'eiint-invite' },
        { id: FAM2, name: 'EI 2', invite_code: 'eiint-invite-2' },
      ],
    })
    await prisma.user.createMany({
      data: [
        { id: PARENT, email: 'p@eiint.test', name: 'P', role: 'parent', family_id: FAM },
        { id: TEEN, email: 't@eiint.test', name: 'T', role: 'teen', family_id: FAM },
        { id: OTHER, email: 'o@eiint.test', name: 'O', role: 'parent', family_id: FAM2 },
      ],
    })
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  it('creates the batch once, replays a retry and serialises a concurrent double submit', async () => {
    const key = newKey()
    const first = await commit.POST(request(TEEN, { events: EVENTS }, key))
    expect(first.status).toBe(201)
    const body = await first.json()
    expect(await count()).toBe(2)
    const rows = await prisma.event.findMany({ where: { id: { in: body.eventIds } }, orderBy: { start_time: 'asc' } })
    expect(rows.map((r) => [r.title, r.created_by, r.family_id, r.location])).toEqual([
      ['EIINT Picture day', TEEN, FAM, null],
      ['EIINT Bake sale', TEEN, FAM, 'Gym'],
    ])
    const replay = await commit.POST(request(TEEN, { events: EVENTS }, key))
    expect(replay.headers.get('Idempotency-Replayed')).toBe('true')
    expect(await replay.json()).toEqual(body)
    expect(await count()).toBe(2)

    const both = newKey()
    const results = await Promise.all([
      commit.POST(request(TEEN, { events: EVENTS }, both)),
      commit.POST(request(TEEN, { events: EVENTS }, both)),
    ])
    expect(results.map((r) => r.status).sort()).toEqual(expect.arrayContaining([201]))
    expect(await count()).toBe(4)
  })

  it('a takeover after a crash finds the committed batch instead of creating it again', async () => {
    const actor = { id: PARENT, family_id: FAM, name: 'P' }
    const before = await count()
    const first = await commitLib.commitImportedEvents(prisma, { events: EVENTS }, actor, 'eiint-record-1')
    const again = await commitLib.commitImportedEvents(prisma, { events: EVENTS }, actor, 'eiint-record-1')
    expect(again).toEqual(first)
    expect(await count()).toBe(before + 2)
  })

  it('undo removes exactly that import, never a hand-made event or another household', async () => {
    const hand = await prisma.event.create({
      data: { family_id: FAM, title: 'EIINT by hand', start_time: new Date(), end_time: new Date(), created_by: TEEN },
    })
    const theirs = await (await commit.POST(request(OTHER, { events: EVENTS }, newKey()))).json()
    const mine = await (await commit.POST(request(TEEN, { events: EVENTS }, newKey()))).json()

    // Another household's token is refused, and nothing of theirs moves.
    expect((await undo.POST(request(PARENT, { token: theirs.undoToken }))).status).toBe(403)
    // The parent cannot use the teen's token either.
    expect((await undo.POST(request(PARENT, { token: mine.undoToken }))).status).toBe(403)

    const res = await undo.POST(request(TEEN, { token: mine.undoToken }))
    expect(await res.json()).toEqual({ removedCount: 2 })
    expect(await prisma.event.count({ where: { id: { in: mine.eventIds } } })).toBe(0)
    expect(await prisma.event.count({ where: { id: hand.id } })).toBe(1)
    expect(await prisma.event.count({ where: { id: { in: theirs.eventIds } } })).toBe(2)
    expect(await (await undo.POST(request(TEEN, { token: mine.undoToken }))).json()).toEqual({ removedCount: 0 })
  })
})
