// New households start simple (O-38) against real Postgres:
//   * POST /api/family stores an explicit blob with only the six sections on;
//   * a row inserted without `features` gets the same blob from the column
//     default (database/migration-features.sql, applied by scripts/migrate.js);
//   * existing households whose stored blob is `{}`, partial or the old column
//     default keep every section that was on by default before O-38, through
//     GET /api/family/features and after a parent's PATCH.
//
// Opt-in like the other integration suites: RUN_DB_INTEGRATION=1 DATABASE_URL=...
// against a disposable database that `node scripts/migrate.js` has prepared.

let sessionAs = ''

jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('next/headers', () => ({
  cookies: async () => ({
    get: (n: string) => (n === 'session_token' && sessionAs ? { value: `session:${sessionAs}` } : undefined),
  }),
  headers: async () => new Headers(),
}))
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

describeWithDatabase('lean feature defaults (Postgres, O-38)', () => {
  let prisma: NonNullable<typeof import('@/lib/prisma').prisma>
  let familyRoute: typeof import('../route')
  let featuresRoute: typeof import('../features/route')
  let lib: typeof import('@/lib/features')

  const P = 'leanint'
  const LEAN_ON = ['calendar', 'chores', 'emergency', 'family', 'lists', 'meals']
  const FORMERLY_ON = ['notes', 'anniversaries', 'rewards', 'budget', 'projects', 'messages', 'analytics']
  const OLD_COLUMN_DEFAULT = {
    chores: true, calendar: true, lists: true, family: true, meals: true, notes: true, anniversaries: true,
    rewards: true, budget: true, projects: true, messages: true, analytics: true, wishlist: false, emergency: true,
    locations: false, pickups: false, allowance: false, travel: false, handoff: false, 'sick-days': false,
    gamification: false, inventory: false,
  }

  const onKeys = (f: Record<string, unknown>) =>
    Object.entries(f)
      .filter(([, v]) => v === true)
      .map(([k]) => k)
      .sort()

  function request(body?: unknown): any {
    const url = new URL('http://localhost/api/test')
    return {
      method: body === undefined ? 'GET' : 'POST',
      url: url.toString(),
      nextUrl: url,
      headers: new Headers({ 'x-forwarded-for': '203.0.113.77' }),
      cookies: { get: (n: string) => (n === 'session_token' ? { value: `session:${sessionAs}` } : undefined) },
      json: async () => body,
    }
  }

  async function cleanup() {
    const users = await prisma.user.findMany({ where: { id: { startsWith: `${P}-` } }, select: { family_id: true } })
    const created = users.map((u) => u.family_id).filter((f): f is string => !!f && !f.startsWith(`${P}-`))
    await prisma.user.deleteMany({ where: { id: { startsWith: `${P}-` } } })
    await prisma.family.deleteMany({ where: { OR: [{ id: { startsWith: `${P}-` } }, { id: { in: created } }] } })
  }

  async function household(id: string, features: unknown) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Family" (id, name, invite_code, features) VALUES ($1, $1, $1, $2::jsonb)`,
      id,
      features === null ? null : JSON.stringify(features),
    )
    await prisma.user.create({
      data: { id: `${id}-parent`, email: `${id}-parent@example.test`, name: 'P', role: 'parent', family_id: id },
    })
    sessionAs = `${id}-parent`
  }

  async function getFeatures(): Promise<Record<string, boolean>> {
    const res: any = await featuresRoute.GET()
    expect(res.status).toBe(200)
    return (await res.json()).features
  }

  beforeAll(async () => {
    const mod = await import('@/lib/prisma')
    if (!mod.prisma) throw new Error('Integration database is not configured')
    prisma = mod.prisma
    familyRoute = await import('../route')
    featuresRoute = await import('../features/route')
    lib = await import('@/lib/features')
    for (const level of ['log', 'info', 'warn', 'error'] as const) jest.spyOn(console, level).mockImplementation(() => undefined)
  })

  beforeEach(cleanup)

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  it('POST /api/family stores only the six sections on', async () => {
    await prisma.user.create({ data: { id: `${P}-new`, email: `${P}-new@example.test`, name: 'New', role: 'parent' } })
    sessionAs = `${P}-new`
    const res: any = await familyRoute.POST(request({ name: `${P} brand new` }))
    expect(res.status).toBe(200)
    const user = await prisma.user.findUnique({ where: { id: `${P}-new` } })
    const fam = await prisma.family.findUnique({ where: { id: user!.family_id! } })
    const stored = fam!.features as Record<string, boolean>
    expect(stored).toEqual(lib.defaultFeatures())
    expect(onKeys(stored)).toEqual(LEAN_ON)
    expect(onKeys(lib.effectiveFeatures(lib.normalizeFeatures(await getFeatures())))).toEqual(LEAN_ON)
  })

  it('a row inserted without features gets the lean blob from the column default', async () => {
    await prisma.$executeRawUnsafe(`INSERT INTO "Family" (id, name, invite_code) VALUES ($1, $1, $1)`, `${P}-coldefault`)
    const fam = await prisma.family.findUnique({ where: { id: `${P}-coldefault` } })
    expect(fam!.features).toEqual(lib.defaultFeatures())
  })

  it.each([
    ['empty', {}],
    ['fixture (#248 stamp)', { gamification: true }],
    ['partial', { meals: true, budget: false }],
    ['old column default', OLD_COLUMN_DEFAULT],
  ])('an existing household with a %s blob keeps its sections', async (label, blob) => {
    const id = `${P}-old-${label.split(' ')[0]}`
    await household(id, blob)
    const read = await getFeatures()
    const expected = { ...lib.normalizeFeatures({}), ...(blob as object) }
    expect(read).toEqual(expected)
    for (const key of FORMERLY_ON) {
      if ((blob as Record<string, unknown>)[key] === false) continue
      expect(read[key]).toBe(true)
    }
  })

  it('a parent toggle on an existing {} household writes the old sections out as on', async () => {
    await household(`${P}-toggle`, {})
    const res: any = await featuresRoute.PATCH(
      new Request('http://localhost/api/family/features', {
        method: 'PATCH',
        body: JSON.stringify({ features: { wishlist: true } }),
      }),
    )
    expect(res.status).toBe(200)
    const fam = await prisma.family.findUnique({ where: { id: `${P}-toggle` } })
    const stored = fam!.features as Record<string, boolean>
    for (const key of FORMERLY_ON) expect(stored[key]).toBe(true)
    expect(stored.gamification).toBe(true)
    expect(stored.wishlist).toBe(true)
  })

  it('Turn on more: a bulk PATCH turns on Rewards with Points & streaks for a new household', async () => {
    await household(`${P}-rewards`, lib.defaultFeatures())
    const res: any = await featuresRoute.PATCH(
      new Request('http://localhost/api/family/features', {
        method: 'PATCH',
        body: JSON.stringify({ features: { gamification: true, rewards: true } }),
      }),
    )
    expect(res.status).toBe(200)
    const fam = await prisma.family.findUnique({ where: { id: `${P}-rewards` } })
    const effective = lib.effectiveFeatures(lib.normalizeFeatures(fam!.features))
    expect(onKeys(effective)).toEqual([...LEAN_ON, 'gamification', 'rewards'].sort())
  })
})
