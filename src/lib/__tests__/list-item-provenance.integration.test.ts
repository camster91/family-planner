// Real-Postgres checks for the ADR-0007 list item fields (#251): unticking a
// recipe-added row whose (list, ingredient, source) already has another open
// row hits the partial unique index "ListItem_open_recipe_source_key"
// (scripts/migrate.js), and updateListItem answers 409 DUPLICATE_OPEN_ITEM
// with the row unchanged; a foreign ingredient id is refused.
// Opt-in like the other integration suites: RUN_DB_INTEGRATION=1 DATABASE_URL=...
// against a disposable database that `node scripts/migrate.js` has prepared.

export {}

const describeWithDatabase = process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip

jest.setTimeout(60_000)

describeWithDatabase('list item provenance against Postgres', () => {
  let prisma: NonNullable<typeof import('@/lib/prisma').prisma>
  let lib: typeof import('@/lib/list-item-update')

  const FAM = 'lipint-family'
  const FAM2 = 'lipint-family-2'
  const USER = 'lipint-user'
  const USER2 = 'lipint-user-2'
  const LIST = 'lipint-list'
  const ING = 'lipint-ingredient'
  const ING2 = 'lipint-ingredient-foreign'
  const OPEN = 'lipint-open'
  const DONE = 'lipint-done'
  const user = { id: USER, family_id: FAM }

  async function cleanup() {
    await prisma.family.deleteMany({ where: { id: { in: [FAM, FAM2] } } })
    await prisma.user.deleteMany({ where: { id: { in: [USER, USER2] } } })
  }

  beforeAll(async () => {
    const mod = await import('@/lib/prisma')
    if (!mod.prisma) throw new Error('Integration database is not configured')
    prisma = mod.prisma
    lib = await import('@/lib/list-item-update')
    await cleanup()
    await prisma.family.createMany({
      data: [
        { id: FAM, name: 'LIP', invite_code: 'lipint-invite' },
        { id: FAM2, name: 'LIP 2', invite_code: 'lipint-invite-2' },
      ],
    })
    await prisma.user.createMany({
      data: [
        { id: USER, email: 'u@lipint.test', name: 'U', role: 'child', family_id: FAM },
        { id: USER2, email: 'u2@lipint.test', name: 'U2', role: 'parent', family_id: FAM2 },
      ],
    })
    await prisma.ingredient.createMany({
      data: [
        { id: ING, family_id: FAM, name: 'Onion' },
        { id: ING2, family_id: FAM2, name: 'Garlic' },
      ],
    })
    await prisma.list.create({ data: { id: LIST, family_id: FAM, name: 'Groceries', type: 'grocery', created_by: USER } })
    const row = { list_id: LIST, content: 'Onion', added_by: USER, ingredient_id: ING, source: 'recipe', source_key: 'recipe:r1' }
    await prisma.listItem.create({ data: { ...row, id: OPEN } })
    await prisma.listItem.create({ data: { ...row, id: DONE, checked: true, checked_by: USER, checked_at: new Date() } })
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  it('maps the partial unique index violation to 409 DUPLICATE_OPEN_ITEM and leaves the row ticked', async () => {
    const res = await lib.updateListItem(prisma, { itemId: DONE, checked: false }, user)
    expect(res.status).toBe(409)
    expect(res.body).toEqual({
      error: { code: 'DUPLICATE_OPEN_ITEM', message: 'This item is already on the list and not yet ticked.', retryable: false },
    })
    expect(await prisma.listItem.findUniqueOrThrow({ where: { id: DONE } })).toMatchObject({ checked: true, checked_by: USER })

    // Other edits of the same ticked row still work.
    const ok = await lib.updateListItem(prisma, { itemId: DONE, amount: 2, unit: 'kg' }, user)
    expect(ok.status).toBe(200)
    expect(ok.body).toMatchObject({ item: { amount: 2, unit: 'kg', checked: true } })
  })

  it('refuses another household ingredient and accepts its own', async () => {
    const foreign = await lib.updateListItem(prisma, { itemId: OPEN, ingredient_id: ING2 }, user)
    expect(foreign).toEqual({ status: 400, body: { error: 'Ingredient not found' } })
    expect((await prisma.listItem.findUniqueOrThrow({ where: { id: OPEN } })).ingredient_id).toBe(ING)

    const cleared = await lib.updateListItem(prisma, { itemId: OPEN, ingredient_id: null }, user)
    expect(cleared.status).toBe(200)
    const own = await lib.updateListItem(prisma, { itemId: OPEN, ingredient_id: ING }, user)
    expect(own.status).toBe(200)
  })
})
