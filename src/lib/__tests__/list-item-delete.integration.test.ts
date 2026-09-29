// Real-Postgres check for `deleteHouseholdListItem` (route inventory F-6, #289),
// the one delete behind DELETE /api/lists/items/[id] and the deprecated
// DELETE /api/lists/items/delete: the relation-scoped lookup must keep another
// household's item out of reach, like a missing one.
// Opt-in like the other integration suites: RUN_DB_INTEGRATION=1 DATABASE_URL=...
// against a disposable database that `node scripts/migrate.js` has prepared.

const describeWithDatabase = process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip

jest.setTimeout(60_000)

describeWithDatabase('list item delete against Postgres', () => {
  let prisma: NonNullable<typeof import('@/lib/prisma').prisma>
  let lib: typeof import('@/lib/list-item-delete')

  const FAM_A = 'lidint-family-a'
  const FAM_B = 'lidint-family-b'
  const USER_A = 'lidint-user-a'
  const USER_B = 'lidint-user-b'

  async function cleanup() {
    await prisma.family.deleteMany({ where: { id: { in: [FAM_A, FAM_B] } } })
    await prisma.user.deleteMany({ where: { id: { in: [USER_A, USER_B] } } })
  }

  beforeAll(async () => {
    const mod = await import('@/lib/prisma')
    if (!mod.prisma) throw new Error('Integration database is not configured')
    prisma = mod.prisma
    lib = await import('@/lib/list-item-delete')
    await cleanup()
    await prisma.family.createMany({
      data: [
        { id: FAM_A, name: 'LID A', invite_code: 'lidint-invite-a' },
        { id: FAM_B, name: 'LID B', invite_code: 'lidint-invite-b' },
      ],
    })
    await prisma.user.createMany({
      data: [
        { id: USER_A, email: 'a@lidint.test', name: 'A', role: 'parent', family_id: FAM_A },
        { id: USER_B, email: 'b@lidint.test', name: 'B', role: 'parent', family_id: FAM_B },
      ],
    })
    await prisma.list.createMany({
      data: [
        { id: 'lidint-list-a', family_id: FAM_A, name: 'Groceries', type: 'grocery', created_by: USER_A },
        { id: 'lidint-list-b', family_id: FAM_B, name: 'Groceries', type: 'grocery', created_by: USER_B },
      ],
    })
    await prisma.listItem.createMany({
      data: [
        { id: 'lidint-item-a', list_id: 'lidint-list-a', content: 'Milk', added_by: USER_A },
        { id: 'lidint-item-b', list_id: 'lidint-list-b', content: 'Bread', added_by: USER_B },
      ],
    })
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  it("another household's item and a missing one are both false, and nothing is deleted", async () => {
    expect(await lib.deleteHouseholdListItem(prisma, 'lidint-item-b', FAM_A)).toBe(false)
    expect(await lib.deleteHouseholdListItem(prisma, 'lidint-no-such-item', FAM_A)).toBe(false)
    expect(await prisma.listItem.count({ where: { id: { in: ['lidint-item-a', 'lidint-item-b'] } } })).toBe(2)
  })

  it("deletes the caller's household item once; a repeat is false", async () => {
    expect(await lib.deleteHouseholdListItem(prisma, 'lidint-item-a', FAM_A)).toBe(true)
    expect(await prisma.listItem.findUnique({ where: { id: 'lidint-item-a' } })).toBeNull()
    expect(await prisma.listItem.findUnique({ where: { id: 'lidint-item-b' } })).not.toBeNull()
    expect(await lib.deleteHouseholdListItem(prisma, 'lidint-item-a', FAM_A)).toBe(false)
  })
})
