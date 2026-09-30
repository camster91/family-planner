// /api/inventory/** against real Postgres (#263): the real Prisma client,
// feature gate, DATE column and foreign keys, with only the session token
// check and next/server replaced. Opt-in like the other integration suites:
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

describeWithDatabase('inventory API against Postgres', () => {
  let prisma: NonNullable<typeof import('@/lib/prisma').prisma>
  let collection: typeof import('../route')
  let item: typeof import('../[id]/route')
  let useSoon: typeof import('../use-soon/route')
  let cook: typeof import('../cook/route')
  let recipes: typeof import('../../recipes/route')

  const FAM = 'invint-family'
  const FAM2 = 'invint-family-2'
  const PARENT = 'invint-parent'
  const TEEN = 'invint-teen'
  const CHILD = 'invint-child'
  const LEAVER = 'invint-leaver'
  const OTHER = 'invint-other'
  const ON = { inventory: true, meals: true }

  const utcPlus = (n: number) => {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() + n)
    return d.toISOString().slice(0, 10)
  }

  function request(as: string, body?: unknown, query: Record<string, string> = {}, headers: Record<string, string> = {}): any {
    const url = new URL('http://localhost/api/inventory')
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
    return {
      url: url.toString(),
      nextUrl: url,
      headers: new Headers(headers),
      cookies: { get: (n: string) => (n === 'session_token' ? { value: `session:${as}` } : undefined) },
      json: async () => body,
    }
  }
  const P = (id: string) => ({ params: Promise.resolve({ id }) })

  async function cleanup() {
    await prisma.family.deleteMany({ where: { id: { in: [FAM, FAM2] } } })
    await prisma.user.deleteMany({ where: { id: { in: [PARENT, TEEN, CHILD, LEAVER, OTHER] } } })
  }

  beforeAll(async () => {
    const mod = await import('@/lib/prisma')
    if (!mod.prisma) throw new Error('Integration database is not configured')
    prisma = mod.prisma
    collection = await import('../route')
    item = await import('../[id]/route')
    useSoon = await import('../use-soon/route')
    cook = await import('../cook/route')
    recipes = await import('../../recipes/route')
    await cleanup()
    await prisma.family.createMany({
      data: [
        { id: FAM, name: 'INV', invite_code: 'invint-invite', features: ON },
        { id: FAM2, name: 'INV 2', invite_code: 'invint-invite-2', features: ON },
      ],
    })
    await prisma.user.createMany({
      data: [
        { id: PARENT, email: 'p@invint.test', name: 'P', role: 'parent', family_id: FAM },
        { id: TEEN, email: 't@invint.test', name: 'T', role: 'teen', family_id: FAM },
        { id: CHILD, email: 'c@invint.test', name: 'C', role: 'child', family_id: FAM },
        { id: LEAVER, email: 'l@invint.test', name: 'L', role: 'teen', family_id: FAM },
        { id: OTHER, email: 'o@invint.test', name: 'O', role: 'parent', family_id: FAM2 },
      ],
    })
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  it('create, read, update, delete: household-scoped, date-only expiry, ingredient link by name', async () => {
    const onion = await prisma.ingredient.create({ data: { family_id: FAM, name: 'Red Onion' } })
    const foreignIng = await prisma.ingredient.create({ data: { family_id: FAM2, name: 'Garlic' } })

    const created = await collection.POST(
      request(TEEN, { name: ' red   ONION ', amount: 2, location: 'pantry', expires_on: utcPlus(1) })
    )
    expect(created.status).toBe(201)
    const { item: onionItem } = await created.json()
    expect(onionItem).toMatchObject({
      name: 'red ONION',
      ingredient_id: onion.id,
      location: 'pantry',
      expires_on: utcPlus(1),
      added_by: TEEN,
      expiry: { status: 'soon', daysLeft: 1 },
    })
    // The DATE column stores the calendar day, not a shifted timestamp.
    const [raw] = await prisma.$queryRaw<Array<{ d: string }>>`SELECT to_char("expires_on", 'YYYY-MM-DD') AS d FROM "InventoryItem" WHERE id = ${onionItem.id}`
    expect(raw.d).toBe(utcPlus(1))

    // Free text: an unknown name creates no ingredient.
    const garlic = await collection.POST(request(PARENT, { name: 'Garlic' }))
    expect((await garlic.json()).item.ingredient_id).toBeNull()
    expect(await prisma.ingredient.count({ where: { family_id: FAM } })).toBe(1)

    // Foreign references and cross-household access.
    const bad = await collection.POST(request(PARENT, { name: 'x', ingredient_id: foreignIng.id }))
    expect(bad.status).toBe(400)
    expect(JSON.stringify(await bad.json())).not.toContain('Garlic')
    const foreignRead = await item.GET(request(OTHER), P(onionItem.id))
    const missingRead = await item.GET(request(OTHER), P('invint-missing'))
    expect(foreignRead.status).toBe(404)
    expect(await foreignRead.json()).toEqual(await missingRead.json())
    expect((await item.PATCH(request(OTHER, { name: 'mine' }), P(onionItem.id))).status).toBe(404)
    expect((await item.DELETE(request(OTHER), P(onionItem.id))).status).toBe(404)
    const otherList = await (await collection.GET(request(OTHER))).json()
    expect(otherList.items).toEqual([])

    // Child reads, cannot write.
    const childList = await (await collection.GET(request(CHILD))).json()
    expect(childList.items.map((i: any) => i.name).sort()).toEqual(['Garlic', 'red ONION'])
    expect((await collection.POST(request(CHILD, { name: 'x' }))).status).toBe(403)
    expect((await item.DELETE(request(CHILD), P(onionItem.id))).status).toBe(403)

    // Update: clear the date, move it; updated_at moves.
    const patched = await item.PATCH(request(TEEN, { expires_on: null, location: 'fridge' }), P(onionItem.id))
    expect(patched.status).toBe(200)
    const after = (await patched.json()).item
    expect(after).toMatchObject({ expires_on: null, location: 'fridge', ingredient_id: onion.id })
    expect(new Date(after.updated_at).getTime()).toBeGreaterThanOrEqual(new Date(onionItem.updated_at).getTime())

    // Deleting the ingredient keeps the item (FK SET NULL).
    await prisma.ingredient.delete({ where: { id: onion.id } })
    expect((await prisma.inventoryItem.findUniqueOrThrow({ where: { id: onionItem.id } })).ingredient_id).toBeNull()

    // Delete.
    expect((await item.DELETE(request(TEEN), P(onionItem.id))).status).toBe(200)
    expect(await prisma.inventoryItem.count({ where: { id: onionItem.id } })).toBe(0)
  })

  it('deleting a member keeps the items they added (added_by SET NULL)', async () => {
    const res = await collection.POST(request(LEAVER, { name: 'Kimchi' }))
    const { item: kimchi } = await res.json()
    await prisma.user.delete({ where: { id: LEAVER } })
    const row = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: kimchi.id } })
    expect(row.added_by).toBeNull()
    expect(row.family_id).toBe(FAM)
  })

  it('use-soon and "what can I cook" read only the household, against real recipes', async () => {
    await prisma.inventoryItem.deleteMany({ where: { family_id: { in: [FAM, FAM2] } } })
    const soup = await recipes.POST(
      request(PARENT, {
        title: 'Tomato soup',
        ingredients: [
          { name: 'Tomatoes', amount: 6 },
          { name: 'Stock', amount: 1, unit: 'L' },
        ],
      })
    )
    expect(soup.status).toBe(201)
    const soupRecipe = (await soup.json()).recipe
    const omelette = await recipes.POST(request(PARENT, { title: 'Omelette', ingredients: [{ name: 'Eggs', amount: 3 }] }))
    const omeletteRecipe = (await omelette.json()).recipe
    await recipes.POST(request(PARENT, { title: 'Saffron rice', ingredients: [{ name: 'Saffron', amount: 1 }] }))
    // The other household has the same ingredient names and its own stock.
    await recipes.POST(request(OTHER, { title: 'Other soup', ingredients: [{ name: 'Tomatoes', amount: 1 }] }))
    await collection.POST(request(OTHER, { name: 'Tomatoes', expires_on: utcPlus(0) }))

    await collection.POST(request(PARENT, { name: 'eggs', expires_on: utcPlus(-1) })) // expired: does not count
    await collection.POST(request(PARENT, { name: 'Eggs', expires_on: utcPlus(10) }))
    await collection.POST(request(PARENT, { name: 'TOMATOES', expires_on: utcPlus(2) }))

    const soon = await (await useSoon.GET(request(CHILD))).json()
    expect(soon.items.map((i: any) => [i.name, i.status, i.label])).toEqual([
      ['eggs', 'expired', 'Best before was yesterday'],
      ['TOMATOES', 'soon', 'Best before in 2 days'],
    ])

    const res = await cook.GET(request(CHILD))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.suggestions.map((s: any) => s.title)).toEqual(['Omelette', 'Tomato soup'])
    expect(body).toMatchObject({ recipesConsidered: 3, truncated: false, inputsTruncated: false })
    expect(body.suggestions[0]).toMatchObject({ recipeId: omeletteRecipe.id, coverage: 1, missing: [] })
    const stockId = soupRecipe.ingredients.find((i: any) => i.ingredient.name === 'Stock').ingredient.id
    expect(body.suggestions[1]).toMatchObject({ haveCount: 1, missingCount: 1, useSoonCount: 1 })
    expect(body.suggestions[1].missing).toEqual([{ ingredientId: stockId, name: 'Stock' }])
    expect(JSON.stringify(body)).not.toContain('Other soup')

    // Input caps: hitting one is reported; the expired row is filtered in SQL,
    // so the two live items fit a cap of 2.
    const { getCookSuggestions } = await import('@/lib/inventory')
    expect((await getCookSuggestions(prisma, FAM, { recipeCap: 1 })).inputsTruncated).toBe(true)
    expect((await getCookSuggestions(prisma, FAM, { inventoryCap: 1 })).inputsTruncated).toBe(true)
    const fits = await getCookSuggestions(prisma, FAM, { inventoryCap: 2 })
    expect(fits.inputsTruncated).toBe(false)
    expect(fits.suggestions.map((s) => s.title)).toEqual(['Omelette', 'Tomato soup'])
  })

  it('the inventory gate (and meals for cook) is enforced from the stored family flags', async () => {
    await prisma.family.update({ where: { id: FAM }, data: { features: { meals: true } } })
    try {
      expect((await collection.GET(request(PARENT))).status).toBe(403)
      expect((await collection.POST(request(PARENT, { name: 'x' }))).status).toBe(403)
      expect((await useSoon.GET(request(PARENT))).status).toBe(403)
    } finally {
      await prisma.family.update({ where: { id: FAM }, data: { features: ON } })
    }
    await prisma.family.update({ where: { id: FAM }, data: { features: { inventory: true, meals: false } } })
    try {
      expect((await cook.GET(request(PARENT))).status).toBe(403)
      expect((await collection.GET(request(PARENT))).status).toBe(200)
    } finally {
      await prisma.family.update({ where: { id: FAM }, data: { features: ON } })
    }
  })

  it('create with an Idempotency-Key (#265) replays the stored 201 and writes one row; a different body is 422', async () => {
    const key = 'invint-scan-row-0000000001'
    const body = { name: 'Invint scan yogurt', amount: 4, unit: 'pots', location: 'fridge' }
    const first = await collection.POST(request(PARENT, body, {}, { 'Idempotency-Key': key }))
    expect(first.status).toBe(201)
    const { item: created } = await first.json()
    const replay = await collection.POST(request(PARENT, { ...body }, {}, { 'Idempotency-Key': key }))
    expect(replay.status).toBe(201)
    expect(replay.headers.get('Idempotency-Replayed')).toBe('true')
    expect((await replay.json()).item.id).toBe(created.id)
    expect(await prisma.inventoryItem.count({ where: { family_id: FAM, name: 'Invint scan yogurt' } })).toBe(1)

    const reused = await collection.POST(request(PARENT, { ...body, amount: 5 }, {}, { 'Idempotency-Key': key }))
    expect(reused.status).toBe(422)
    expect((await reused.json()).error.code).toBe('IDEMPOTENCY_KEY_REUSED')
    const record = await prisma.idempotencyRecord.findFirst({ where: { scope: `user:${PARENT}`, key } })
    expect(record).toMatchObject({ family_id: FAM, action: 'inventory-item.create', response_status: 201 })
    expect(await prisma.inventoryItem.count({ where: { family_id: FAM, name: 'Invint scan yogurt' } })).toBe(1)
    await prisma.idempotencyRecord.deleteMany({ where: { scope: `user:${PARENT}`, key } })
  })

  it('search words match literally: % and _ are not wildcards', async () => {
    await prisma.inventoryItem.createMany({
      data: [
        { id: 'invint-like-1', family_id: FAM, name: '100% juice', location: 'fridge' },
        { id: 'invint-like-2', family_id: FAM, name: '1000 grams rice', location: 'pantry' },
        { id: 'invint-like-3', family_id: FAM, name: 'a_b snack', location: 'pantry' },
        { id: 'invint-like-4', family_id: FAM, name: 'axb snack', location: 'pantry' },
      ],
    })
    try {
      const names = async (q: string) =>
        ((await (await collection.GET(request(PARENT, undefined, { q }))).json()).items as Array<{ name: string }>).map(
          (i) => i.name
        )
      expect(await names('100%')).toEqual(['100% juice'])
      expect(await names('a_b')).toEqual(['a_b snack'])
    } finally {
      await prisma.inventoryItem.deleteMany({ where: { id: { startsWith: 'invint-like-' } } })
    }
  })

  it('deleting the household removes its inventory (cascade)', async () => {
    await collection.POST(request(OTHER, { name: 'Butter' }))
    expect(await prisma.inventoryItem.count({ where: { family_id: FAM2 } })).toBeGreaterThan(0)
    await prisma.family.delete({ where: { id: FAM2 } })
    expect(await prisma.inventoryItem.count({ where: { family_id: FAM2 } })).toBe(0)
  })
})
