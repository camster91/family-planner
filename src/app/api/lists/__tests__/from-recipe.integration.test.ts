// POST /api/lists/items/from-recipe and /undo-add against real Postgres
// (ADR-0007 child D, #253): the IdempotencyRecord unique index, the partial
// unique index "ListItem_open_recipe_source_key" under concurrent requests
// (createMany skipDuplicates = ON CONFLICT DO NOTHING), the per-household
// advisory lock behind resolveDefaultGroceryList, and the undo window.
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

describeWithDatabase('recipe → grocery add against Postgres', () => {
  let prisma: NonNullable<typeof import('@/lib/prisma').prisma>
  let fromRecipe: typeof import('../items/from-recipe/route')
  let undoAdd: typeof import('../items/undo-add/route')
  let defaultGrocery: typeof import('../default-grocery/route')

  const FAM = 'frint-family'
  const FAM2 = 'frint-family-2'
  const FAM3 = 'frint-family-3'
  const PARENT = 'frint-parent'
  const CHILD = 'frint-child'
  const OTHER = 'frint-other'
  const LONER = 'frint-fam3-parent'
  const LIST = 'frint-list'
  const RECIPE = 'frint-recipe'
  const RECIPE3 = 'frint-recipe-3'
  const MEAL1 = 'frint-meal-1'
  const MEAL2 = 'frint-meal-2'
  const ING = ['frint-ing-onion', 'frint-ing-rice', 'frint-ing-beans']

  let keySeq = 0
  const newKey = () => `frint-key-${Date.now().toString(36)}-${(keySeq++).toString().padStart(6, '0')}`

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

  const open = (where: Record<string, unknown> = {}) =>
    prisma.listItem.count({ where: { list_id: LIST, checked: false, source: 'recipe', ...where } })

  async function cleanup() {
    await prisma.family.deleteMany({ where: { id: { in: [FAM, FAM2, FAM3] } } })
    await prisma.user.deleteMany({ where: { id: { in: [PARENT, CHILD, OTHER, LONER] } } })
  }

  beforeAll(async () => {
    const mod = await import('@/lib/prisma')
    if (!mod.prisma) throw new Error('Integration database is not configured')
    prisma = mod.prisma
    fromRecipe = await import('../items/from-recipe/route')
    undoAdd = await import('../items/undo-add/route')
    defaultGrocery = await import('../default-grocery/route')
    await cleanup()
    await prisma.family.createMany({
      data: [
        { id: FAM, name: 'FR', invite_code: 'frint-invite' },
        { id: FAM2, name: 'FR 2', invite_code: 'frint-invite-2' },
        { id: FAM3, name: 'FR 3', invite_code: 'frint-invite-3' },
      ],
    })
    await prisma.user.createMany({
      data: [
        { id: PARENT, email: 'p@frint.test', name: 'P', role: 'parent', family_id: FAM },
        { id: CHILD, email: 'c@frint.test', name: 'C', role: 'child', family_id: FAM },
        { id: OTHER, email: 'o@frint.test', name: 'O', role: 'parent', family_id: FAM2 },
        { id: LONER, email: 'l@frint.test', name: 'L', role: 'parent', family_id: FAM3 },
      ],
    })
    await prisma.list.create({ data: { id: LIST, family_id: FAM, name: 'Groceries', type: 'grocery', created_by: PARENT } })
    await prisma.ingredient.createMany({
      data: [
        { id: ING[0], family_id: FAM, name: 'Onion', unit: 'pcs' },
        { id: ING[1], family_id: FAM, name: 'Rice', unit: 'g' },
        { id: ING[2], family_id: FAM, name: 'Black Beans' },
        { id: 'frint-ing-3', family_id: FAM3, name: 'Salt' },
      ],
    })
    await prisma.recipe.create({
      data: {
        id: RECIPE,
        family_id: FAM,
        title: 'Burrito bowl',
        servings: 4,
        created_by: PARENT,
        ingredients: {
          create: [
            { ingredient_id: ING[0], amount: 2 },
            { ingredient_id: ING[1], amount: 300, unit: 'g' },
            { ingredient_id: ING[2], amount: 1, unit: 'can' },
          ],
        },
      },
    })
    await prisma.recipe.create({
      data: {
        id: RECIPE3,
        family_id: FAM3,
        title: 'Salted water',
        servings: 1,
        created_by: LONER,
        ingredients: { create: [{ ingredient_id: 'frint-ing-3', amount: 1 }] },
      },
    })
    await prisma.familyMeal.createMany({
      data: [
        { id: MEAL1, family_id: FAM, date: new Date('2026-10-01'), meal_type: 'dinner', recipe_id: RECIPE, servings: 8, created_by: PARENT },
        { id: MEAL2, family_id: FAM, date: new Date('2026-10-02'), meal_type: 'dinner', recipe_id: RECIPE, created_by: PARENT },
      ],
    })
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.listItem.deleteMany({ where: { list_id: LIST } })
    await prisma.idempotencyRecord.deleteMany({ where: { family_id: { in: [FAM, FAM2, FAM3] } } })
  })

  it('8 concurrent requests with one key write one set of rows; later retries replay', async () => {
    const key = newKey()
    const body = { recipeId: RECIPE, mealId: MEAL1, listId: LIST }
    const responses = await Promise.all(Array.from({ length: 8 }, () => fromRecipe.POST(request(PARENT, body, key))))
    const originals = responses.filter((r) => r.status === 201 && r.headers.get('Idempotency-Replayed') === null)
    expect(originals).toHaveLength(1)
    for (const r of responses) {
      if (r === originals[0]) continue
      expect(r.status === 409 || r.headers.get('Idempotency-Replayed') === 'true').toBe(true)
    }
    const first = await originals[0].json()
    expect(first).toMatchObject({ listId: LIST, createdCount: 3, alreadyOnListCount: 0, possibleDuplicates: [] })
    expect(await open()).toBe(3)

    // Meal servings (8) over recipe servings (4) doubles the amounts.
    const rows = await prisma.listItem.findMany({ where: { list_id: LIST }, orderBy: { position: 'asc' } })
    expect(rows.map((r) => [r.content, r.amount, r.unit])).toEqual([
      ['Onion', 4, 'pcs'],
      ['Rice', 600, 'g'],
      ['Black Beans', 2, 'can'],
    ])
    for (const r of rows) {
      expect(r).toMatchObject({
        source: 'recipe',
        source_key: `meal:${MEAL1}`,
        source_request_id: first.requestId,
        recipe_id: RECIPE,
        meal_id: MEAL1,
        added_by: PARENT,
        quantity: 1,
      })
    }

    const replay = await fromRecipe.POST(request(PARENT, body, key))
    expect(replay.status).toBe(201)
    expect(replay.headers.get('Idempotency-Replayed')).toBe('true')
    expect(await replay.json()).toEqual(first)
    expect(await open()).toBe(3)

    // Same key, different body.
    const reused = await fromRecipe.POST(request(PARENT, { ...body, servings: 2 }, key))
    expect(reused.status).toBe(422)
    expect((await reused.json()).error.code).toBe('IDEMPOTENCY_KEY_REUSED')
    expect(await open()).toBe(3)
  })

  it('different keys racing for the same meal leave one open row per ingredient', async () => {
    const body = { recipeId: RECIPE, mealId: MEAL1, listId: LIST }
    const responses = await Promise.all(
      Array.from({ length: 6 }, () => fromRecipe.POST(request(PARENT, body, newKey())))
    )
    expect(responses.every((r) => r.status === 201)).toBe(true)
    const bodies = await Promise.all(responses.map((r) => r.json()))
    expect(bodies.reduce((s, b) => s + b.createdCount, 0)).toBe(3)
    expect(bodies.reduce((s, b) => s + b.alreadyOnListCount, 0)).toBe(6 * 3 - 3)
    for (const ing of ING) expect(await open({ ingredient_id: ing })).toBe(1)
  })

  it('checked rows do not block, another meal gets its own rows, a free-text lookalike is flagged', async () => {
    await prisma.listItem.create({ data: { list_id: LIST, content: '  onion ', added_by: PARENT, position: 0 } })

    const a = await fromRecipe.POST(request(PARENT, { recipeId: RECIPE, mealId: MEAL1, listId: LIST }, newKey()))
    const aBody = await a.json()
    expect(aBody.createdCount).toBe(3)
    expect(aBody.possibleDuplicates).toHaveLength(1)
    expect(aBody.possibleDuplicates[0].ingredientId).toBe(ING[0])
    // Not merged: the free-text row and the recipe row both exist.
    expect(await prisma.listItem.count({ where: { list_id: LIST, checked: false } })).toBe(4)

    // Bought: ticked rows leave the partial index, so a new add is not blocked.
    await prisma.listItem.updateMany({ where: { list_id: LIST, source_key: `meal:${MEAL1}` }, data: { checked: true } })
    const again = await (await fromRecipe.POST(request(PARENT, { recipeId: RECIPE, mealId: MEAL1, listId: LIST }, newKey()))).json()
    expect(again).toMatchObject({ createdCount: 3, alreadyOnListCount: 0 })

    // A different meal (no meal servings: recipe servings) adds its own rows.
    const other = await (await fromRecipe.POST(request(CHILD, { recipeId: RECIPE, mealId: MEAL2, listId: LIST }, newKey()))).json()
    expect(other).toMatchObject({ createdCount: 3, alreadyOnListCount: 0 })
    expect(await open({ source_key: `meal:${MEAL2}`, ingredient_id: ING[1], amount: 300 })).toBe(1)
    // The recipe itself (no meal) is a third source.
    const recipeOnly = await (
      await fromRecipe.POST(request(PARENT, { recipeId: RECIPE, listId: LIST, ingredientIds: [ING[2]] }, newKey()))
    ).json()
    expect(recipeOnly).toMatchObject({ createdCount: 1, alreadyOnListCount: 0 })
    expect(await open({ source_key: `recipe:${RECIPE}` })).toBe(1)
  })

  it('concurrent first adds in a household without a grocery list create exactly one list', async () => {
    const responses = await Promise.all([
      ...Array.from({ length: 5 }, () => fromRecipe.POST(request(LONER, { recipeId: RECIPE3 }, newKey()))),
      ...Array.from({ length: 3 }, () => defaultGrocery.POST(request(LONER))),
    ])
    expect(responses.every((r) => r.status === 201 || r.status === 200)).toBe(true)
    const lists = await prisma.list.findMany({ where: { family_id: FAM3 } })
    expect(lists).toHaveLength(1)
    expect(lists[0]).toMatchObject({ name: 'Groceries', type: 'grocery' })
    expect(await prisma.listItem.count({ where: { list_id: lists[0].id, checked: false } })).toBe(1)
  })

  it('resolveDefaultGroceryList serialises racing callers per household (advisory lock)', async () => {
    const { resolveDefaultGroceryList } = await import('@/lib/grocery-from-recipe')
    for (let round = 0; round < 5; round++) {
      await prisma.list.deleteMany({ where: { family_id: FAM3 } })
      const results = await Promise.all(Array.from({ length: 10 }, () => resolveDefaultGroceryList(prisma, FAM3, LONER)))
      expect(new Set(results.map((r) => r.id)).size).toBe(1)
      expect(results.filter((r) => r.created)).toHaveLength(1)
      expect(await prisma.list.count({ where: { family_id: FAM3 } })).toBe(1)
    }
    // An existing grocery list wins over a newer shopping list; nothing is created.
    await prisma.list.create({ data: { family_id: FAM3, name: 'Shop', type: 'shopping', created_by: LONER } })
    const resolved = await resolveDefaultGroceryList(prisma, FAM3, LONER)
    expect(resolved).toMatchObject({ name: 'Groceries', type: 'grocery', created: false })
  })

  it('undo removes only that request’s unchecked rows, only for its author, only within 10 minutes', async () => {
    const first = await (await fromRecipe.POST(request(PARENT, { recipeId: RECIPE, mealId: MEAL1, listId: LIST }, newKey()))).json()
    const second = await (await fromRecipe.POST(request(PARENT, { recipeId: RECIPE, mealId: MEAL2, listId: LIST }, newKey()))).json()
    const onion = await prisma.listItem.findFirstOrThrow({ where: { source_request_id: first.requestId, ingredient_id: ING[0] } })
    await prisma.listItem.update({ where: { id: onion.id }, data: { checked: true } })

    // Another member of the household, and another household.
    expect((await undoAdd.POST(request(CHILD, { requestId: first.requestId }))).status).toBe(403)
    expect((await undoAdd.POST(request(OTHER, { requestId: first.requestId }))).status).toBe(404)

    const undone = await undoAdd.POST(request(PARENT, { requestId: first.requestId }))
    expect(undone.status).toBe(200)
    expect(await undone.json()).toEqual({ requestId: first.requestId, removedCount: 2, keptCheckedCount: 1 })
    expect(await prisma.listItem.count({ where: { source_request_id: first.requestId } })).toBe(1)
    expect(await prisma.listItem.count({ where: { source_request_id: second.requestId } })).toBe(3)
    // Retrying the undo is harmless.
    expect(await (await undoAdd.POST(request(PARENT, { requestId: first.requestId }))).json()).toMatchObject({ removedCount: 0 })

    // Older than the window: refused, rows kept.
    await prisma.idempotencyRecord.update({
      where: { id: second.requestId },
      data: { created_at: new Date(Date.now() - 11 * 60 * 1000) },
    })
    const late = await undoAdd.POST(request(PARENT, { requestId: second.requestId }))
    expect(late.status).toBe(409)
    expect((await late.json()).error.code).toBe('UNDO_WINDOW_EXPIRED')
    expect(await prisma.listItem.count({ where: { source_request_id: second.requestId } })).toBe(3)
  })

  it('a failure after the insert rolls the rows back, so a same-key retry writes undoable rows', async () => {
    await prisma.listItem.deleteMany({ where: { list_id: LIST } })
    const backfill = require('@/lib/backfill/meals-groceries')
    const spy = jest.spyOn(backfill, 'normalizeName').mockImplementationOnce(() => {
      throw new Error('lookalike scan failed')
    })
    const key = newKey()
    const body = { recipeId: RECIPE, mealId: MEAL1, listId: LIST }
    try {
      expect((await fromRecipe.POST(request(PARENT, body, key))).status).toBe(500)
    } finally {
      spy.mockRestore()
    }
    expect(await prisma.listItem.count({ where: { list_id: LIST } })).toBe(0)

    const retry = await fromRecipe.POST(request(PARENT, body, key))
    expect(retry.status).toBe(201)
    const added = await retry.json()
    expect(added).toMatchObject({ createdCount: 3, alreadyOnListCount: 0 })
    // The undo expiry is absolute: the request record's creation + 10 minutes.
    const record = await prisma.idempotencyRecord.findUniqueOrThrow({ where: { id: added.requestId } })
    expect(Date.parse(added.undoExpiresAt)).toBe(record.created_at.getTime() + 10 * 60 * 1000)
    const undone = await (await undoAdd.POST(request(PARENT, { requestId: added.requestId }))).json()
    expect(undone).toMatchObject({ removedCount: 3 })
    expect(await prisma.listItem.count({ where: { list_id: LIST } })).toBe(0)
  })

  it('foreign recipe, meal and list ids are refused without writing', async () => {
    const before = await prisma.listItem.count()
    const foreignRecipe = await fromRecipe.POST(request(OTHER, { recipeId: RECIPE }, newKey()))
    expect(foreignRecipe.status).toBe(404)
    const foreignMeal = await fromRecipe.POST(request(LONER, { recipeId: RECIPE3, mealId: MEAL1 }, newKey()))
    expect(foreignMeal.status).toBe(404)
    const foreignList = await fromRecipe.POST(request(LONER, { recipeId: RECIPE3, listId: LIST }, newKey()))
    expect(foreignList.status).toBe(404)
    expect(await prisma.listItem.count()).toBe(before)
    // Refusals are not stored, so no idempotency row survives them.
    expect(await prisma.idempotencyRecord.count({ where: { family_id: { in: [FAM2, FAM3] } } })).toBe(0)
  })
})
