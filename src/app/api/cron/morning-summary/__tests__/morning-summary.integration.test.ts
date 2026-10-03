// Morning summary against real Postgres (O-40): the new columns default to
// off for a row written without them, the once-a-day claim is a real
// conditional UPDATE (concurrent calls send once), households stay apart, and
// the in-app row and email go through the one delivery helper. Mail sending is
// mocked; only next/server is replaced otherwise. Opt-in like the other
// integration suites: RUN_DB_INTEGRATION=1 DATABASE_URL=... against a
// disposable database that `node scripts/migrate.js` has prepared.

jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('@/lib/mail', () => {
  const actual = jest.requireActual('@/lib/mail')
  return {
    ...actual,
    sendMail: jest.fn(async () => undefined),
    isMailConfigured: () => true,
  }
})

export {}

const describeWithDatabase = process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip

jest.setTimeout(60_000)

describeWithDatabase('morning summary against Postgres', () => {
  let prisma: NonNullable<typeof import('@/lib/prisma').prisma>
  let route: typeof import('../route')
  let sendMail: jest.Mock

  const FAM = 'msint-family'
  const FAM2 = 'msint-family-2'
  const PARENT = 'msint-parent'
  const KID = 'msint-kid'
  const OTHER = 'msint-other'
  const SECRET = 'msint-cron-secret-value'
  const SAVED = process.env.CRON_SECRET
  const TZ = 'America/Toronto'

  // Today in Toronto, whatever the clock says, so the test runs any day.
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
  const todayDate = new Date(`${today}T00:00:00Z`)

  function post(secret: string | null = SECRET): Promise<any> {
    const url = new URL('http://localhost/api/cron/morning-summary')
    const headers = new Headers()
    if (secret) headers.set('x-cron-secret', secret)
    return route.POST({
      method: 'POST',
      url: url.toString(),
      nextUrl: url,
      headers,
    } as any)
  }

  async function cleanup() {
    await prisma.notification.deleteMany({
      where: { user_id: { in: [PARENT, KID, OTHER] } },
    })
    await prisma.chore.deleteMany({
      where: { family_id: { in: [FAM, FAM2] } },
    })
    await prisma.family.deleteMany({ where: { id: { in: [FAM, FAM2] } } })
    await prisma.user.deleteMany({
      where: { id: { in: [PARENT, KID, OTHER] } },
    })
  }

  beforeAll(async () => {
    const mod = await import('@/lib/prisma')
    if (!mod.prisma) throw new Error('Integration database is not configured')
    prisma = mod.prisma
    route = await import('../route')
    sendMail = (await import('@/lib/mail')).sendMail as jest.Mock
    process.env.CRON_SECRET = SECRET
    await cleanup()
    await prisma.family.createMany({
      data: [
        { id: FAM, name: 'Summary home', invite_code: 'msint-invite' },
        { id: FAM2, name: 'Summary other', invite_code: 'msint-invite-2' },
      ],
    })
    // Written the way a row from before O-40 looks: the INSERT names none of
    // the morning_summary_* columns, so only the column DEFAULT can fill them.
    await prisma.$executeRawUnsafe(
      `INSERT INTO "User" (id, email, name, role, family_id, email_verified) VALUES
        ($1, 'p@msint.test', 'Pat Parent', 'parent', $4, true),
        ($2, 'k@msint.test', 'Kim Kid', 'child', $4, true),
        ($3, 'o@msint.test', 'Oli Other', 'parent', $5, false)`,
      PARENT,
      KID,
      OTHER,
      FAM,
      FAM2
    )
    await prisma.chore.createMany({
      data: [
        {
          id: 'msint-c1',
          family_id: FAM,
          title: 'Feed the cat',
          assigned_to: KID,
          due_date: todayDate,
          created_by: PARENT,
        },
        {
          id: 'msint-c2',
          family_id: FAM,
          title: 'Done one',
          assigned_to: KID,
          due_date: todayDate,
          status: 'completed',
          created_by: PARENT,
        },
        {
          id: 'msint-c3',
          family_id: FAM2,
          title: 'FOREIGN chore',
          assigned_to: OTHER,
          due_date: todayDate,
          created_by: OTHER,
        },
      ],
    })
  })

  afterAll(async () => {
    await cleanup()
    if (SAVED === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = SAVED
    await prisma.$disconnect()
  })

  it('an old row, written without the columns, is opted out; nothing is sent', async () => {
    const rows = await prisma.user.findMany({
      where: { id: { in: [PARENT, KID, OTHER] } },
      select: {
        morning_summary_enabled: true,
        morning_summary_time_zone: true,
        morning_summary_sent_on: true,
      },
    })
    for (const r of rows) {
      expect(r).toEqual({
        morning_summary_enabled: false,
        morning_summary_time_zone: null,
        morning_summary_sent_on: null,
      })
    }
    const res = await post()
    expect(res.status).toBe(200)
    expect((await res.json()).sent).toEqual({ inApp: 0, email: 0 })
    expect(
      await prisma.notification.count({
        where: { user_id: { in: [PARENT, KID, OTHER] } },
      })
    ).toBe(0)
  })

  it('fails closed without the secret', async () => {
    expect((await post(null)).status).toBe(401)
    expect((await post('wrong-secret')).status).toBe(401)
  })

  it('sends once per person per local day, even to concurrent calls', async () => {
    await prisma.user.updateMany({
      where: { id: { in: [PARENT, KID, OTHER] } },
      data: { morning_summary_enabled: true, morning_summary_time_zone: TZ },
    })
    sendMail.mockClear()
    const results = await Promise.all([post(), post(), post()])
    const bodies = await Promise.all(results.map((r) => r.json()))
    const inApp = bodies.reduce((n, b) => n + b.sent.inApp, 0)
    expect(inApp).toBe(3)

    const notes = await prisma.notification.findMany({
      where: { user_id: { in: [PARENT, KID, OTHER] }, type: 'summary' },
      select: { user_id: true, message: true },
    })
    expect(notes).toHaveLength(3)
    const byUser = Object.fromEntries(notes.map((n) => [n.user_id, n.message]))
    expect(byUser[KID]).toBe('Today: 1 chore (Feed the cat).')
    expect(byUser[PARENT]).toBe('Today: 1 chore to check.')
    expect(byUser[OTHER]).toBe('Today: 1 chore (FOREIGN chore).')
    expect(byUser[KID]).not.toContain('FOREIGN')

    // Verified addresses get email; the unverified one gets in-app only.
    const recipients = sendMail.mock.calls.map((c) => c[0].to).sort()
    expect(recipients).toEqual(['k@msint.test', 'p@msint.test'])

    const claimed = await prisma.user.findMany({
      where: { id: { in: [PARENT, KID, OTHER] } },
      select: { morning_summary_sent_on: true },
    })
    for (const c of claimed) expect(c.morning_summary_sent_on).toBe(today)

    // A later retry the same day sends nothing.
    const again = await (await post()).json()
    expect(again.sent).toEqual({ inApp: 0, email: 0 })
    expect(again.skipped.alreadySent).toBe(3)
  })
})
