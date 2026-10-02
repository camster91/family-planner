// Short family codes against real Postgres: a new 12-character code typed as
// shown (XXXX-XXXX-XXXX) and an old 24-character code both join through
// POST /api/family/join; the real join/lookup limiter refuses past its limit;
// a unique collision on Family.invite_code surfaces as the P2002 that the
// create/rotate retry loops catch (isInviteCodeCollision).
//
// Opt-in like the other integration suites: RUN_DB_INTEGRATION=1 DATABASE_URL=...
// against a disposable database that `node scripts/migrate.js` has prepared.

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

describeWithDatabase('family codes (Postgres)', () => {
  let prisma: NonNullable<typeof import('@/lib/prisma').prisma>
  let join: typeof import('../join/route')
  let lookup: typeof import('../lookup/route')
  let codes: typeof import('@/lib/family-invite')

  const P = 'fcodeint'
  const NEW_FAM = `${P}-family-new`
  const OLD_FAM = `${P}-family-old`
  const OLD_CODE = 'usm7ghmbcypks2c29m9mdeha' // a 24-character O-34 code
  let newCode = ''
  // Each test gets its own IP so the per-IP buckets do not carry over.
  let ipCounter = 10
  let ip = ''

  function request(as: string, body?: unknown, query?: Record<string, string>): any {
    const url = new URL('http://localhost/api/test')
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v)
    return {
      method: body === undefined ? 'GET' : 'POST',
      url: url.toString(),
      nextUrl: url,
      headers: new Headers({ 'x-forwarded-for': ip }),
      cookies: { get: (n: string) => (n === 'session_token' ? { value: `session:${as}` } : undefined) },
      json: async () => body,
    }
  }

  async function cleanup() {
    await prisma.user.deleteMany({ where: { id: { startsWith: `${P}-` } } })
    await prisma.family.deleteMany({ where: { id: { startsWith: `${P}-` } } })
    await prisma.rateLimitEntry.deleteMany({
      where: { OR: [{ key: { contains: P } }, { key: { startsWith: 'join-ip:203.0.113.' } }] },
    })
  }

  beforeAll(async () => {
    const mod = await import('@/lib/prisma')
    if (!mod.prisma) throw new Error('Integration database is not configured')
    prisma = mod.prisma
    join = await import('../join/route')
    lookup = await import('../lookup/route')
    codes = await import('@/lib/family-invite')
    for (const level of ['log', 'info', 'warn', 'error'] as const) jest.spyOn(console, level).mockImplementation(() => undefined)
  })

  beforeEach(async () => {
    await cleanup()
    ip = `203.0.113.${ipCounter++}`
    newCode = codes.createFamilyInviteCode()
    await prisma.family.createMany({
      data: [
        { id: NEW_FAM, name: 'New code home', invite_code: newCode },
        { id: OLD_FAM, name: 'Old code home', invite_code: OLD_CODE },
      ],
    })
    await prisma.user.createMany({
      data: ['a', 'b', 'c'].map((s) => ({ id: `${P}-joiner-${s}`, email: `${P}-joiner-${s}@example.test`, name: s, role: 'child' })),
    })
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  it('joins with a new code typed as shown (XXXX-XXXX-XXXX)', async () => {
    const shown = codes.formatFamilyCode(newCode)
    expect(shown).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
    const found: any = await lookup.GET(request(`${P}-joiner-a`, undefined, { code: shown }))
    expect(found.status).toBe(200)
    const res: any = await join.POST(request(`${P}-joiner-a`, { inviteCode: shown }))
    expect(res.status).toBe(200)
    expect(await prisma.user.findUnique({ where: { id: `${P}-joiner-a` } })).toMatchObject({ family_id: NEW_FAM })
  })

  it('joins with an old 24-character code, as stored and grouped; the stored code is unchanged', async () => {
    const res: any = await join.POST(request(`${P}-joiner-b`, { inviteCode: OLD_CODE }))
    expect(res.status).toBe(200)
    const grouped: any = await join.POST(request(`${P}-joiner-c`, { inviteCode: codes.formatFamilyCode(OLD_CODE).toUpperCase() }))
    expect(grouped.status).toBe(200)
    expect(await prisma.user.count({ where: { id: { startsWith: `${P}-joiner-` }, family_id: OLD_FAM } })).toBe(2)
    expect((await prisma.family.findUnique({ where: { id: OLD_FAM } }))!.invite_code).toBe(OLD_CODE)
  })

  it('the real limiter refuses an account after 10 join attempts an hour, across IPs', async () => {
    for (let i = 0; i < 10; i++) {
      ip = `203.0.113.${200 + i}`
      expect(((await join.POST(request(`${P}-joiner-a`, { inviteCode: 'zzzzzzzzzzzz' }))) as any).status).toBe(404)
    }
    ip = '203.0.113.250'
    const res: any = await join.POST(request(`${P}-joiner-a`, { inviteCode: newCode }))
    expect(res.status).toBe(429)
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect(await prisma.user.findUnique({ where: { id: `${P}-joiner-a` } })).toMatchObject({ family_id: null })
  })

  it('a duplicate invite_code is a P2002 that isInviteCodeCollision recognizes', async () => {
    let caught: unknown
    try {
      await prisma.family.create({ data: { id: `${P}-family-dup`, name: 'Dup', invite_code: newCode } })
    } catch (err) {
      caught = err
    }
    expect(codes.isInviteCodeCollision(caught)).toBe(true)
    // Same inside an interactive transaction, as the routes use it.
    caught = undefined
    try {
      await prisma.$transaction(async (tx) => {
        await tx.family.updateMany({ where: { id: OLD_FAM }, data: { invite_code: newCode } })
      })
    } catch (err) {
      caught = err
    }
    expect(codes.isInviteCodeCollision(caught)).toBe(true)
    expect((await prisma.family.findUnique({ where: { id: OLD_FAM } }))!.invite_code).toBe(OLD_CODE)
  })
})
