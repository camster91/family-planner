// /api/recipes and the meal recipe link against real Postgres (ADR-0007,
// #251): the real Prisma client, feature gate and FKs, with only the session
// token check and next/server replaced. Opt-in like the other integration
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

describeWithDatabase('recipes API against Postgres', () => {
  let prisma: NonNullable<typeof import('@/lib/prisma').prisma>
  let recipes: typeof import('../route')
  let recipe: typeof import('../[id]/route')
  let meals: typeof import('../../meals/route')
  let meal: typeof import('../../meals/[id]/route')

  const FAM = 'rcpint-family'
  const FAM2 = 'rcpint-family-2'
  const PARENT = 'rcpint-parent'
  const TEEN = 'rcpint-teen'
  const OTHER = 'rcpint-other'

  function request(as: string, body?: unknown, query: Record<string, string> = {}): any {
    const url = new URL('http://localhost/api/test')
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
    return {
      url: url.toString(),
      nextUrl: url,
      headers: new Headers(),
      cookies: { get: (n: string) => (n === 'session_token' ? { value: `session:${as}` } : undefined) },
      json: async () => body,
    }
  }
  const P = (id: string) => ({ params: Promise.resolve({ id }) })

  async function cleanup() {
    await prisma.family.deleteMany({ where: { id: { in: [FAM, FAM2] } } })
    await prisma.user.deleteMany({ where: { id: { in: [PARENT, TEEN, OTHER] } } })
  }

  beforeAll(async () => {
    const mod = await import('@/lib/prisma')
    if (!mod.prisma) throw new Error('Integration database is not configured')
    prisma = mod.prisma
    recipes = await import('../route')
    recipe = await import('../[id]/route')
    meals = await import('../../meals/route')
    meal = await import('../../meals/[id]/route')
    await cleanup()
    await prisma.family.createMany({
      data: [
        { id: FAM, name: 'RCP', invite_code: 'rcpint-invite' },
        { id: FAM2, name: 'RCP 2', invite_code: 'rcpint-invite-2' },
      ],
    })
    await prisma.user.createMany({
      data: [
        { id: PARENT, email: 'p@rcpint.test', name: 'P', role: 'parent', family_id: FAM },
        { id: TEEN, email: 't@rcpint.test', name: 'T', role: 'teen', family_id: FAM },
        { id: OTHER, email: 'o@rcpint.test', name: 'O', role: 'parent', family_id: FAM2 },
      ],
    })
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  it('create, read, link to a meal, replace ingredients, delete: all household-scoped', async () => {
    await prisma.ingredient.create({ data: { family_id: FAM, name: 'Red Onion' } })
    const foreignIng = await prisma.ingredient.create({ data: { family_id: FAM2, name: 'Garlic' } })

    const created = await recipes.POST(
      request(TEEN, {
        title: 'Chili',
        prep_time: 15,
        servings: 4,
        ingredients: [
          { name: ' red   onion ', amount: 1 },
          { name: 'Beans', amount: 400, unit: 'g' },
        ],
      })
    )
    expect(created.status).toBe(201)
    const { recipe: r } = await created.json()
    expect(r.ingredients.map((i: any) => i.ingredient.name).sort()).toEqual(['Beans', 'Red Onion'])
    expect(await prisma.ingredient.count({ where: { family_id: FAM } })).toBe(2)

    // Foreign references in bodies and cross-family reads.
    const bad = await recipes.POST(request(TEEN, { title: 'x', ingredients: [{ ingredient_id: foreignIng.id, amount: 1 }] }))
    expect(bad.status).toBe(400)
    expect(JSON.stringify(await bad.json())).not.toContain('Garlic')
    expect((await recipe.GET(request(OTHER), P(r.id))).status).toBe(404)
    expect((await recipe.PATCH(request(OTHER, { title: 'mine' }), P(r.id))).status).toBe(404)

    // Meal link.
    const mealRes = await meals.POST(request(PARENT, { date: '2026-09-30', meal_type: 'dinner', recipe_id: r.id, servings: 6 }))
    expect(mealRes.status).toBe(201)
    const { meal: m } = await mealRes.json()
    expect(m).toMatchObject({ recipe_name: 'Chili', servings: 6, recipe: { id: r.id, title: 'Chili', prep_time: 15 } })
    expect((await meals.POST(request(OTHER, { date: '2026-09-30', meal_type: 'dinner', recipe_id: r.id }))).status).toBe(400)
    expect((await meal.PATCH(request(OTHER, { id: m.id, notes: 'x' }))).status).toBe(403)

    // Replace the ingredient set.
    const patched = await recipe.PATCH(request(PARENT, { ingredients: [{ name: 'Beans', amount: 800, unit: 'g' }] }), P(r.id))
    expect(patched.status).toBe(200)
    const after = await patched.json()
    expect(after.recipe.ingredients).toHaveLength(1)
    expect(after.recipe.ingredients[0]).toMatchObject({ amount: 800, ingredient: { name: 'Beans' } })
    expect(new Date(after.recipe.updated_at).getTime()).toBeGreaterThanOrEqual(new Date(r.updated_at).getTime())

    // Teen cannot delete; parent can; the meal keeps its snapshot (FK SET NULL).
    expect((await recipe.DELETE(request(TEEN), P(r.id))).status).toBe(403)
    expect((await recipe.DELETE(request(PARENT), P(r.id))).status).toBe(200)
    const kept = await prisma.familyMeal.findUniqueOrThrow({ where: { id: m.id } })
    expect(kept).toMatchObject({ recipe_id: null, recipe_name: 'Chili', servings: 6 })
    expect(await prisma.recipeIngredient.count({ where: { recipe_id: r.id } })).toBe(0)
  })

  it('concurrent writes of the same ingredient in different casing create one ingredient', async () => {
    const variants = (w: string) => [w, w.toLowerCase(), ` ${w.toUpperCase()} `, w.replace(' ', '  '), w.toUpperCase()]
    for (const word of ['Brown Sugar', 'Sea Salt', 'Olive Oil', 'Rolled Oats', 'Dark Chocolate']) {
      const results = await Promise.all(
        variants(word).map((name, i) =>
          recipes.POST(request(PARENT, { title: `${word} ${i}`, ingredients: [{ name, amount: 1 }] }))
        )
      )
      expect(results.map((r) => r.status)).toEqual(variants(word).map(() => 201))
      const rows = await prisma.ingredient.findMany({
        where: { family_id: FAM, name: { contains: word.split(' ')[1], mode: 'insensitive' } },
      })
      expect(rows).toHaveLength(1)
    }
  })

  it('the meals feature gate is enforced from the stored family flags', async () => {
    await prisma.family.update({ where: { id: FAM }, data: { features: { meals: false } } })
    try {
      expect((await recipes.GET(request(PARENT))).status).toBe(403)
      expect((await recipes.POST(request(PARENT, { title: 'x' }))).status).toBe(403)
    } finally {
      await prisma.family.update({ where: { id: FAM }, data: { features: { meals: true } } })
    }
    expect((await recipes.GET(request(PARENT))).status).toBe(200)
  })
})
