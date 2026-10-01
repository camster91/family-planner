// Notification preferences against real Postgres (#286, PR101 D-5): the
// columns default to true for a row written without them (an "old" row), PATCH
// persists through the real Prisma client and idempotency table, and the one
// delivery helper creates nothing for a muted category. Only the session token
// check and next/server are replaced. Opt-in like the other integration
// suites: RUN_DB_INTEGRATION=1 DATABASE_URL=... against a disposable database
// that `node scripts/migrate.js` has prepared.

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

describeWithDatabase('notification preferences against Postgres', () => {
  let prisma: NonNullable<typeof import('@/lib/prisma').prisma>
  let route: typeof import('../preferences/route')
  let delivery: typeof import('@/lib/notification-delivery')

  const FAM = 'prefint-family'
  const FAM2 = 'prefint-family-2'
  const PARENT = 'prefint-parent'
  const TEEN = 'prefint-teen'
  const OTHER = 'prefint-other'
  const ALL_ON = { chores: true, events: true, messages: true }
  const QUIET_OFF = { enabled: false, start: '22:00', end: '07:00', timeZone: null }

  function request(as: string, method: 'GET' | 'PATCH', body?: unknown, headers: Record<string, string> = {}): any {
    const url = new URL('http://localhost/api/users/preferences')
    return {
      method,
      url: url.toString(),
      nextUrl: url,
      headers: new Headers(headers),
      cookies: { get: (n: string) => (n === 'session_token' ? { value: `session:${as}` } : undefined) },
      json: async () => {
        if (body === undefined) throw new SyntaxError('Unexpected end of JSON input')
        return body
      },
    }
  }

  async function columns(id: string) {
    const u = await prisma.user.findUniqueOrThrow({
      where: { id },
      select: { notify_chores: true, notify_events: true, notify_messages: true },
    })
    return { chores: u.notify_chores, events: u.notify_events, messages: u.notify_messages }
  }

  async function cleanup() {
    await prisma.family.deleteMany({ where: { id: { in: [FAM, FAM2] } } })
    await prisma.user.deleteMany({ where: { id: { in: [PARENT, TEEN, OTHER] } } })
  }

  beforeAll(async () => {
    const mod = await import('@/lib/prisma')
    if (!mod.prisma) throw new Error('Integration database is not configured')
    prisma = mod.prisma
    route = await import('../preferences/route')
    delivery = await import('@/lib/notification-delivery')
    await cleanup()
    await prisma.family.createMany({
      data: [
        { id: FAM, name: 'Prefs home', invite_code: 'prefint-invite' },
        { id: FAM2, name: 'Prefs other', invite_code: 'prefint-invite-2' },
      ],
    })
    // Written the way a row from before #286 looks: the INSERT names none of
    // the notify_* columns, so only the column DEFAULT can fill them.
    await prisma.$executeRawUnsafe(
      `INSERT INTO "User" (id, email, name, role, family_id) VALUES
        ($1, 'p@prefint.test', 'Pat', 'parent', $4),
        ($2, 't@prefint.test', 'Tay', 'teen', $4),
        ($3, 'o@prefint.test', 'Oli', 'parent', $5)`,
      PARENT,
      TEEN,
      OTHER,
      FAM,
      FAM2
    )
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  it('an old row, written without the columns, reads as all on', async () => {
    for (const id of [PARENT, TEEN, OTHER]) expect(await columns(id)).toEqual(ALL_ON)
    const res = await route.GET(request(TEEN, 'GET'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await res.json()).toEqual({ quietHours: QUIET_OFF, preferences: ALL_ON })
  })

  it("PATCH persists the caller's own switches and nobody else's", async () => {
    const res = await route.PATCH(request(TEEN, 'PATCH', { chores: false, messages: false }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ quietHours: QUIET_OFF, preferences: { chores: false, events: true, messages: false } })
    expect(await columns(TEEN)).toEqual({ chores: false, events: true, messages: false })
    expect(await columns(PARENT)).toEqual(ALL_ON)
    expect(await columns(OTHER)).toEqual(ALL_ON)

    // A fresh read (new request) sees the stored values.
    const read = await route.GET(request(TEEN, 'GET'))
    expect(await read.json()).toEqual({ quietHours: QUIET_OFF, preferences: { chores: false, events: true, messages: false } })
  })

  it('an unknown key is refused before anything is written', async () => {
    const res = await route.PATCH(request(PARENT, 'PATCH', { userId: TEEN, chores: true }))
    expect(res.status).toBe(400)
    expect(await columns(TEEN)).toEqual({ chores: false, events: true, messages: false })
    expect(await columns(PARENT)).toEqual(ALL_ON)
  })

  it('Idempotency-Key replays from the real idempotency table', async () => {
    const key = { 'Idempotency-Key': 'prefint-key-000000001' }
    const first = await route.PATCH(request(PARENT, 'PATCH', { events: false }, key))
    expect(first.status).toBe(200)
    // Someone changes it back in between; a replay must not re-apply the old body.
    await prisma.user.update({ where: { id: PARENT }, data: { notify_events: true } })
    const replay = await route.PATCH(request(PARENT, 'PATCH', { events: false }, key))
    expect(replay.status).toBe(200)
    expect(replay.headers.get('Idempotency-Replayed')).toBe('true')
    expect(await columns(PARENT)).toEqual(ALL_ON)
    const record = await prisma.idempotencyRecord.findFirst({ where: { scope: `user:${PARENT}`, key: key['Idempotency-Key'] } })
    expect(record).toMatchObject({ family_id: FAM, action: 'user.notification-preferences.update', response_status: 200 })
    await prisma.idempotencyRecord.deleteMany({ where: { scope: `user:${PARENT}` } })
  })

  it('the delivery helper creates nothing for a muted category and a row otherwise', async () => {
    // TEEN has chores and messages off, events on.
    const muted = await delivery.deliverNotification({ userId: TEEN, title: 't', message: 'm', type: 'reward' })
    expect(muted.delivered).toBe(false)
    const on = await delivery.deliverNotification({ userId: TEEN, title: 't', message: 'm', type: 'event' })
    expect(on.delivered).toBe(true)
    const always = await delivery.deliverNotification({ userId: TEEN, title: 't', message: 'm', type: 'system' })
    expect(always.delivered).toBe(true)
    const rows = await prisma.notification.findMany({ where: { user_id: TEEN }, orderBy: { created_at: 'asc' } })
    expect(rows.map((r) => r.type).sort()).toEqual(['event', 'system'])
  })

  it('quiet hours (#141, O-32): an old row reads as off; PATCH persists; delivery stores the row and marks it quiet', async () => {
    const before = await prisma.user.findUniqueOrThrow({
      where: { id: OTHER },
      select: { quiet_hours_enabled: true, quiet_hours_start: true, quiet_hours_end: true, quiet_hours_time_zone: true },
    })
    expect(before).toEqual({
      quiet_hours_enabled: false,
      quiet_hours_start: '22:00',
      quiet_hours_end: '07:00',
      quiet_hours_time_zone: null,
    })

    const night = { enabled: true, start: '22:00', end: '07:00', timeZone: 'America/Toronto' }
    const res = await route.PATCH(request(OTHER, 'PATCH', { quietHours: night }))
    expect(res.status).toBe(200)
    expect((await res.json()).quietHours).toEqual(night)
    const read = await route.GET(request(OTHER, 'GET'))
    expect(await read.json()).toEqual({ preferences: ALL_ON, quietHours: night })

    // 23:30 in Toronto (summer).
    const result = await delivery.deliverNotification(
      { userId: OTHER, title: 'Late', message: 'm', type: 'event' },
      new Date('2026-06-02T03:30:00Z')
    )
    expect(result.delivered).toBe(true)
    expect(result.delivered && result.quiet).toBe(true)
    expect(await prisma.notification.count({ where: { user_id: OTHER } })).toBe(1)
    await prisma.notification.deleteMany({ where: { user_id: OTHER } })
  })
})
