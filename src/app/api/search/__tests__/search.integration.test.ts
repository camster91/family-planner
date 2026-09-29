// GET /api/search against real Postgres (route inventory F-3): the real
// Prisma client, ILIKE matching, relation filter for list items, feature
// flags and ordering, with only the session token check and next/server
// replaced. Opt-in like the other integration suites: RUN_DB_INTEGRATION=1
// DATABASE_URL=... against a disposable database that `node scripts/migrate.js`
// has prepared.

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

describeWithDatabase('household search against Postgres', () => {
  let prisma: NonNullable<typeof import('@/lib/prisma').prisma>
  let route: typeof import('../route')

  const FAM = 'srchint-family'
  const FAM2 = 'srchint-family-2'
  const PARENT = 'srchint-parent'
  const CHILD = 'srchint-child'
  const OTHER = 'srchint-other'
  const ON = { meals: true, notes: true, inventory: true }

  function request(as: string, q: string): any {
    const url = new URL('http://localhost/api/search')
    url.searchParams.set('q', q)
    return {
      url: url.toString(),
      nextUrl: url,
      headers: new Headers(),
      cookies: { get: (n: string) => (n === 'session_token' ? { value: `session:${as}` } : undefined) },
    }
  }

  async function search(as: string, q: string) {
    const res = await route.GET(request(as, q))
    expect(res.status).toBe(200)
    return (await res.json()).results as Array<{ type: string; id: string; title: string; href: string }>
  }

  async function cleanup() {
    await prisma.family.deleteMany({ where: { id: { in: [FAM, FAM2] } } })
    await prisma.user.deleteMany({ where: { id: { in: [PARENT, CHILD, OTHER] } } })
  }

  beforeAll(async () => {
    const mod = await import('@/lib/prisma')
    if (!mod.prisma) throw new Error('Integration database is not configured')
    prisma = mod.prisma
    route = await import('../route')
    await cleanup()
    await prisma.family.createMany({
      data: [
        { id: FAM, name: 'Search home', invite_code: 'srchint-invite', features: ON },
        { id: FAM2, name: 'Search other', invite_code: 'srchint-invite-2', features: ON },
      ],
    })
    await prisma.user.createMany({
      data: [
        { id: PARENT, email: 'p@srchint.test', name: 'Robin Pancake', role: 'parent', family_id: FAM },
        { id: CHILD, email: 'c@srchint.test', name: 'Kit', role: 'child', family_id: FAM },
        { id: OTHER, email: 'o@srchint.test', name: 'Pancake Other', role: 'parent', family_id: FAM2 },
      ],
    })
    const start = new Date('2026-10-03T09:00:00Z')
    for (const [family_id, created_by, tag] of [
      [FAM, PARENT, 'Mine'],
      [FAM2, OTHER, 'Theirs'],
    ] as const) {
      await prisma.event.create({
        data: { family_id, created_by, title: `${tag} pancake breakfast`, start_time: start, end_time: start },
      })
      await prisma.chore.create({
        data: { family_id, created_by, assigned_to: created_by, title: `${tag} pancake pan wash`, due_date: start },
      })
      const list = await prisma.list.create({ data: { family_id, created_by, name: `${tag} pancake supplies`, type: 'grocery' } })
      await prisma.listItem.create({ data: { list_id: list.id, added_by: created_by, content: `${tag} PANCAKE mix` } })
      await prisma.recipe.create({ data: { family_id, created_by, title: `${tag} pancakes`, description: 'fluffy' } })
      await prisma.pinnedNote.create({ data: { family_id, created_by, title: `${tag} note`, body: 'pancake day is Tuesday' } })
      await prisma.inventoryItem.create({ data: { family_id, added_by: created_by, name: `${tag} pancake syrup` } })
      await prisma.inventoryItem.create({ data: { family_id, added_by: created_by, name: `${tag} old pancake`, status: 'consumed' } })
    }
    await prisma.inventoryItem.create({ data: { family_id: FAM, added_by: PARENT, name: '500 g flour' } })
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  it('finds every type case-insensitively, in the caller household only', async () => {
    const rows = await search(PARENT, 'pAnCaKe')
    expect(rows.map((r) => [r.type, r.title])).toEqual([
      ['member', 'Robin Pancake'],
      ['event', 'Mine pancake breakfast'],
      ['chore', 'Mine pancake pan wash'],
      ['list', 'Mine pancake supplies'],
      ['list_item', 'Mine PANCAKE mix'],
      ['recipe', 'Mine pancakes'],
      ['note', 'Mine note'],
      ['inventory', 'Mine pancake syrup'],
    ])
    expect(JSON.stringify(rows)).not.toMatch(/Theirs|Pancake Other|old pancake/)
    const other = await search(OTHER, 'pancake')
    expect(other.length).toBe(8)
    expect(JSON.stringify(other)).not.toMatch(/Mine|Robin/)
  })

  it('a child gets only lists, list items and food', async () => {
    const rows = await search(CHILD, 'pancake')
    expect(rows.map((r) => r.type)).toEqual(['list', 'list_item', 'inventory'])
  })

  it('treats % and _ as plain characters, not wildcards', async () => {
    expect(await search(PARENT, '50%')).toEqual([])
    expect(await search(PARENT, '5_0')).toEqual([])
    // A trailing backslash is a character too, not a broken pattern.
    expect(await search(PARENT, 'flour\\')).toEqual([])
    expect((await search(PARENT, '500')).map((r) => r.title)).toEqual(['500 g flour'])
  })

  it('leaves out a type once its feature is turned off', async () => {
    await prisma.family.update({ where: { id: FAM }, data: { features: { ...ON, notes: false, inventory: false } } })
    try {
      const rows = await search(PARENT, 'pancake')
      expect(rows.map((r) => r.type)).not.toContain('note')
      expect(rows.map((r) => r.type)).not.toContain('inventory')
    } finally {
      await prisma.family.update({ where: { id: FAM }, data: { features: ON } })
    }
  })
})
