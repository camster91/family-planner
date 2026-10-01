// GET /api/chores opt-in paging (O-19) against real Postgres: walking every
// page with `limit`/`cursor` returns each of the household's chores exactly
// once in (due_date, id) order, including chores that share a due date across
// a page boundary, and never another household's. Without `limit` the route
// still returns everything with no `nextCursor`. `order=desc` walks the same
// way newest first (chores page history). Opt-in like the other
// integration suites: RUN_DB_INTEGRATION=1 DATABASE_URL=... against a
// disposable database that `node scripts/migrate.js` has prepared.

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

describeWithDatabase('chores paging against Postgres', () => {
  let prisma: NonNullable<typeof import('@/lib/prisma').prisma>
  let route: typeof import('../route')

  const FAM = 'chpgint-family'
  const FAM2 = 'chpgint-family-2'
  const PARENT = 'chpgint-parent'
  const OTHER = 'chpgint-other'

  function request(as: string, query: Record<string, string> = {}): any {
    const url = new URL('http://localhost/api/chores')
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
    return {
      method: 'GET',
      url: url.toString(),
      nextUrl: url,
      headers: new Headers(),
      cookies: { get: (n: string) => (n === 'session_token' ? { value: `session:${as}` } : undefined) },
    }
  }

  async function cleanup() {
    await prisma.family.deleteMany({ where: { id: { in: [FAM, FAM2] } } })
    await prisma.user.deleteMany({ where: { id: { in: [PARENT, OTHER] } } })
  }

  beforeAll(async () => {
    const mod = await import('@/lib/prisma')
    if (!mod.prisma) throw new Error('Integration database is not configured')
    prisma = mod.prisma
    route = await import('../route')
    await cleanup()
    await prisma.family.createMany({
      data: [
        { id: FAM, name: 'Paging home', invite_code: 'chpgint-invite' },
        { id: FAM2, name: 'Paging other', invite_code: 'chpgint-invite-2' },
      ],
    })
    await prisma.user.createMany({
      data: [
        { id: PARENT, email: 'p@chpgint.test', name: 'Robin', role: 'parent', family_id: FAM },
        { id: OTHER, email: 'o@chpgint.test', name: 'Other', role: 'parent', family_id: FAM2 },
      ],
    })
    // 7 chores, several sharing a due date, so page boundaries fall inside a tie.
    const days = ['2026-10-01', '2026-10-01', '2026-10-01', '2026-10-02', '2026-10-02', '2026-10-03', '2026-10-04']
    await prisma.chore.createMany({
      data: days.map((d, i) => ({
        id: `chpgint-a-${i}`,
        family_id: FAM,
        title: `Chore ${i}`,
        assigned_to: PARENT,
        created_by: PARENT,
        due_date: new Date(`${d}T09:00:00Z`),
      })),
    })
    await prisma.chore.create({
      data: {
        id: 'chpgint-b-0',
        family_id: FAM2,
        title: 'Other household chore',
        assigned_to: OTHER,
        created_by: OTHER,
        due_date: new Date('2026-10-01T09:00:00Z'),
      },
    })
  })

  afterAll(cleanup)

  it('walks every page once, in (due_date, id) order, household-scoped', async () => {
    const seen: string[] = []
    let cursor: string | null = null
    let pages = 0
    do {
      const query: Record<string, string> = { limit: '2' }
      if (cursor) query.cursor = cursor
      const res = await route.GET(request(PARENT, query))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.chores.length).toBeLessThanOrEqual(2)
      seen.push(...body.chores.map((c: { id: string }) => c.id))
      cursor = body.nextCursor
      pages += 1
      expect(pages).toBeLessThan(10)
    } while (cursor)

    expect(pages).toBe(4)
    expect(seen).toEqual([0, 1, 2, 3, 4, 5, 6].map((i) => `chpgint-a-${i}`))
    expect(seen).not.toContain('chpgint-b-0')
  })

  async function walk(first: string | null, extra: Record<string, string>) {
    const seen: string[] = []
    let cursor = first
    let pages = 0
    do {
      const query: Record<string, string> = { limit: '2', ...extra }
      if (cursor) query.cursor = cursor
      const res = await route.GET(request(PARENT, query))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.chores.length).toBeLessThanOrEqual(2)
      seen.push(...body.chores.map((c: { id: string }) => c.id))
      cursor = body.nextCursor
      pages += 1
      expect(pages).toBeLessThan(10)
    } while (cursor)
    return { seen, pages }
  }

  it('walks newest first with order=desc, every chore once, household-scoped', async () => {
    const { seen, pages } = await walk(null, { order: 'desc' })
    expect(pages).toBe(4)
    expect(seen).toEqual([6, 5, 4, 3, 2, 1, 0].map((i) => `chpgint-a-${i}`))
    expect(seen).not.toContain('chpgint-b-0')
  })

  it("continues the chores page's newest-first first page from its cursor", async () => {
    // What /dashboard/chores does for history: the first page straight from
    // Prisma in CHORE_HISTORY_ORDER, then "Load more" through the API.
    const { CHORE_HISTORY_ORDER, choreOrderBy, encodeChoreCursor } = await import('@/lib/chore-paging')
    const firstPage = await prisma.chore.findMany({
      where: { family_id: FAM },
      orderBy: choreOrderBy(CHORE_HISTORY_ORDER),
      take: 3,
    })
    const rest = await walk(encodeChoreCursor(firstPage[firstPage.length - 1]), { order: CHORE_HISTORY_ORDER })
    expect([...firstPage.map((c) => c.id), ...rest.seen]).toEqual([6, 5, 4, 3, 2, 1, 0].map((i) => `chpgint-a-${i}`))
  })

  it('rejects an unknown order', async () => {
    const res = await route.GET(request(PARENT, { limit: '2', order: 'sideways' }))
    expect(res.status).toBe(400)
  })

  it('is unchanged without limit: every chore, no nextCursor', async () => {
    const res = await route.GET(request(PARENT))
    const body = await res.json()
    expect(body).not.toHaveProperty('nextCursor')
    expect(body.chores.map((c: { id: string }) => c.id).sort()).toEqual(
      [0, 1, 2, 3, 4, 5, 6].map((i) => `chpgint-a-${i}`).sort()
    )
  })
})
