// Grocery store sections (#273) against real Postgres: the override upsert
// under concurrency (unique (family_id, name_key)), two-household isolation,
// Ingredient.section, List.sort_by_section, walking-order trips serialised
// by the advisory lock, and the cascades. Only the session token check and
// next/server are replaced. Opt-in like the other integration suites:
// RUN_DB_INTEGRATION=1 DATABASE_URL=... against a disposable database that
// `node scripts/migrate.js` has prepared.

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

describeWithDatabase('grocery store sections against Postgres', () => {
  let prisma: NonNullable<typeof import('@/lib/prisma').prisma>
  let items: typeof import('../items/route')
  let update: typeof import('../items/update/route')
  let section: typeof import('../items/section/route')
  let sort: typeof import('../section-sort/route')

  const FAM = 'secint-family'
  const FAM2 = 'secint-family-2'
  const PARENT = 'secint-parent'
  const CHILD = 'secint-child'
  const OTHER = 'secint-other'
  const LIST = 'secint-list'
  const LIST2 = 'secint-list-2'

  function request(as: string, body?: unknown, query: Record<string, string> = {}): any {
    const url = new URL('http://localhost/api/lists/items')
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
    return {
      url: url.toString(),
      nextUrl: url,
      headers: new Headers(),
      cookies: { get: (n: string) => (n === 'session_token' ? { value: `session:${as}` } : undefined) },
      json: async () => body,
    }
  }

  async function cleanup() {
    await prisma.family.deleteMany({ where: { id: { in: [FAM, FAM2] } } })
    await prisma.user.deleteMany({ where: { id: { in: [PARENT, CHILD, OTHER] } } })
  }

  async function row(id: string, listId: string, content: string, extra: Record<string, unknown> = {}) {
    await prisma.listItem.create({
      data: { id, list_id: listId, content, added_by: listId === LIST ? PARENT : OTHER, ...extra },
    })
  }

  beforeAll(async () => {
    const mod = await import('@/lib/prisma')
    if (!mod.prisma) throw new Error('Integration database is not configured')
    prisma = mod.prisma
    items = await import('../items/route')
    update = await import('../items/update/route')
    section = await import('../items/section/route')
    sort = await import('../section-sort/route')
    await cleanup()
    await prisma.family.createMany({
      data: [
        { id: FAM, name: 'SEC', invite_code: 'secint-invite' },
        { id: FAM2, name: 'SEC 2', invite_code: 'secint-invite-2' },
      ],
    })
    await prisma.user.createMany({
      data: [
        { id: PARENT, email: 'p@secint.test', name: 'P', role: 'parent', family_id: FAM },
        { id: CHILD, email: 'c@secint.test', name: 'C', role: 'child', family_id: FAM },
        { id: OTHER, email: 'o@secint.test', name: 'O', role: 'parent', family_id: FAM2 },
      ],
    })
    await prisma.list.createMany({
      data: [
        { id: LIST, family_id: FAM, name: 'Groceries', type: 'grocery', created_by: PARENT },
        { id: LIST2, family_id: FAM2, name: 'Groceries', type: 'shopping', created_by: OTHER },
      ],
    })
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  it('a new list sorts by section by default; parent switches it off, a child cannot', async () => {
    expect((await prisma.list.findUniqueOrThrow({ where: { id: LIST } })).sort_by_section).toBe(true)
    expect((await sort.PATCH(request(CHILD, { listId: LIST, sortBySection: false }))).status).toBe(403)
    const off = await sort.PATCH(request(PARENT, { listId: LIST, sortBySection: false }))
    expect(off.status).toBe(200)
    expect((await prisma.list.findUniqueOrThrow({ where: { id: LIST } })).sort_by_section).toBe(false)
    // Another household's list: 404, untouched.
    expect((await sort.PATCH(request(PARENT, { listId: LIST2, sortBySection: false }))).status).toBe(404)
    expect((await prisma.list.findUniqueOrThrow({ where: { id: LIST2 } })).sort_by_section).toBe(true)
    await sort.PATCH(request(PARENT, { listId: LIST, sortBySection: true }))
  })

  it('concurrent moves of one name leave one override row; households never share it', async () => {
    await row('secint-milk', LIST, 'Milk')
    await row('secint-milk-2', LIST, '  MILK ')
    await row('secint-milk-b', LIST2, 'Milk')
    const targets = ['household', 'frozen', 'pantry', 'bakery', 'household', 'frozen', 'pantry', 'bakery']
    const results = await Promise.all(
      targets.map((s, i) => section.PATCH(request(i % 2 ? CHILD : PARENT, { itemId: i % 2 ? 'secint-milk-2' : 'secint-milk', section: s })))
    )
    expect(results.map((r) => r.status)).toEqual(targets.map(() => 200))
    const prefs = await prisma.grocerySectionPreference.findMany({ where: { family_id: FAM } })
    expect(prefs).toHaveLength(1)
    expect(prefs[0].name_key).toBe('milk')
    expect(targets).toContain(prefs[0].section)

    // The database enforces the key, not just the route.
    await expect(
      prisma.grocerySectionPreference.create({ data: { family_id: FAM, name_key: 'milk', section: 'frozen' } })
    ).rejects.toMatchObject({ code: 'P2002' })

    // Household B still gets the keyword section, then its own override.
    const b1 = await (await items.GET(request(OTHER, undefined, { listId: LIST2 }))).json()
    expect(b1.items.find((i: any) => i.id === 'secint-milk-b').section).toBe('dairy_eggs')
    await section.PATCH(request(OTHER, { itemId: 'secint-milk-b', section: 'snacks_drinks' }))
    const a = await (await items.GET(request(CHILD, undefined, { listId: LIST }))).json()
    expect(a.items.find((i: any) => i.id === 'secint-milk').section).toBe(prefs[0].section)
    expect(await prisma.grocerySectionPreference.count({ where: { name_key: 'milk', family_id: { in: [FAM, FAM2] } } })).toBe(2)

    // A foreign item id is a 404 and writes nothing.
    const before = await prisma.grocerySectionPreference.findMany({ where: { family_id: FAM2 } })
    const foreign = await section.PATCH(request(PARENT, { itemId: 'secint-milk-b', section: 'household' }))
    expect(foreign.status).toBe(404)
    expect(await prisma.grocerySectionPreference.findMany({ where: { family_id: FAM2 } })).toEqual(before)

    // Clearing deletes the row.
    await section.PATCH(request(PARENT, { itemId: 'secint-milk', section: null }))
    expect(await prisma.grocerySectionPreference.count({ where: { family_id: FAM } })).toBe(0)
  })

  it('a linked row sets Ingredient.section, which resolves rows with other text', async () => {
    const tomato = await prisma.ingredient.create({ data: { family_id: FAM, name: 'Tomatoes' } })
    await row('secint-tom', LIST, 'Tomatoes', { ingredient_id: tomato.id })
    await row('secint-roma', LIST, 'Roma', { ingredient_id: tomato.id })
    const res = await section.PATCH(request(CHILD, { itemId: 'secint-tom', section: 'pantry' }))
    expect(await res.json()).toMatchObject({ sections: { 'secint-tom': 'pantry', 'secint-roma': 'pantry' } })
    expect((await prisma.ingredient.findUniqueOrThrow({ where: { id: tomato.id } })).section).toBe('pantry')
    await prisma.grocerySectionPreference.deleteMany({ where: { family_id: FAM } })
    const body = await (await items.GET(request(CHILD, undefined, { listId: LIST }))).json()
    expect(body.items.find((i: any) => i.id === 'secint-roma').section).toBe('pantry')
  })

  it('parallel ticks on one list make one trip holding each section once', async () => {
    const names = ['Bananas', 'Dish soap', 'Bread', 'Apples', 'Shampoo', 'Frozen peas', 'Rice', 'Cheese']
    await Promise.all(names.map((n, i) => row(`secint-tick-${i}`, LIST, n)))
    const res = await Promise.all(
      names.map((_, i) => update.PATCH(request(i % 2 ? CHILD : PARENT, { itemId: `secint-tick-${i}`, checked: true })))
    )
    expect(res.map((r) => r.status)).toEqual(names.map(() => 200))
    const trips = await prisma.groceryShoppingSession.findMany({ where: { family_id: FAM } })
    expect(trips).toHaveLength(1)
    expect([...trips[0].sections].sort()).toEqual(
      ['bakery', 'dairy_eggs', 'frozen', 'household', 'pantry', 'personal_care', 'produce'].sort()
    )
    expect(await prisma.groceryShoppingSession.count({ where: { family_id: FAM2 } })).toBe(0)
  })

  it('cascades: deleting a member keeps the household choice; deleting the list or household removes its data', async () => {
    await row('secint-soap', LIST, 'Hand soap')
    await section.PATCH(request(CHILD, { itemId: 'secint-soap', section: 'household' }))
    await prisma.listItem.deleteMany({ where: { added_by: CHILD } })
    await prisma.user.delete({ where: { id: CHILD } })
    const pref = await prisma.grocerySectionPreference.findFirstOrThrow({ where: { family_id: FAM, name_key: 'hand soap' } })
    expect(pref.updated_by).toBeNull()

    await prisma.list.delete({ where: { id: LIST } })
    expect(await prisma.groceryShoppingSession.count({ where: { family_id: FAM } })).toBe(0)
    await prisma.family.delete({ where: { id: FAM } })
    expect(await prisma.grocerySectionPreference.count({ where: { family_id: FAM } })).toBe(0)
  })
})
