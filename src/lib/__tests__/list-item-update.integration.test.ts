// Real-Postgres check for the list item tick write (#162, Codex review on
// PR #247): concurrent opposite updates of one item must apply in the order
// the server receives them, and each response must be the real outcome.
// Opt-in like the other integration suites: RUN_DB_INTEGRATION=1 DATABASE_URL=...
// against a disposable database that `node scripts/migrate.js` has prepared.
import { Client } from 'pg'

const describeWithDatabase = process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip

jest.setTimeout(60_000)

describeWithDatabase('list item update against Postgres', () => {
  let prisma: NonNullable<typeof import('@/lib/prisma').prisma>
  let lib: typeof import('@/lib/list-item-update')

  const FAM = 'liuint-family'
  const A = 'liuint-user-a'
  const B = 'liuint-user-b'
  const LIST = 'liuint-list'
  const ITEM = 'liuint-item'
  const user = (id: string) => ({ id, family_id: FAM })
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  async function cleanup() {
    await prisma.family.deleteMany({ where: { id: FAM } })
    await prisma.user.deleteMany({ where: { id: { in: [A, B] } } })
  }

  beforeAll(async () => {
    const mod = await import('@/lib/prisma')
    if (!mod.prisma) throw new Error('Integration database is not configured')
    prisma = mod.prisma
    lib = await import('@/lib/list-item-update')
    await cleanup()
    await prisma.family.create({ data: { id: FAM, name: 'LIU Int', invite_code: 'liuint-invite' } })
    await prisma.user.createMany({
      data: [
        { id: A, email: 'a@liuint.test', name: 'A', role: 'parent', family_id: FAM },
        { id: B, email: 'b@liuint.test', name: 'B', role: 'teen', family_id: FAM },
      ],
    })
    await prisma.list.create({ data: { id: LIST, family_id: FAM, name: 'Groceries', type: 'grocery', created_by: A } })
    await prisma.listItem.create({ data: { id: ITEM, list_id: LIST, content: 'Milk', added_by: A } })
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.listItem.update({ where: { id: ITEM }, data: { checked: false, checked_by: null, checked_at: null } })
  })

  /**
   * Hold the item row locked from another connection, start `first`, then
   * `second`, then release. Both requests are in flight together; `second`
   * is received last.
   */
  async function contended(first: () => Promise<any>, second: () => Promise<any>) {
    const holder = new Client({ connectionString: process.env.DATABASE_URL })
    await holder.connect()
    try {
      await holder.query('BEGIN')
      await holder.query('SELECT "id" FROM "ListItem" WHERE "id" = $1 FOR UPDATE', [ITEM])
      const p1 = first()
      await sleep(150)
      const p2 = second()
      await sleep(150)
      await holder.query('COMMIT')
      return await Promise.all([p1, p2])
    } finally {
      await holder.end()
    }
  }

  it('opposite concurrent updates: the last received wins and each response is its real outcome', async () => {
    const [resA, resB] = await contended(
      () => lib.updateListItem(prisma, { itemId: ITEM, checked: true }, user(A)),
      () => lib.updateListItem(prisma, { itemId: ITEM, checked: false }, user(B))
    )
    expect(resA.status).toBe(200)
    expect(resB.status).toBe(200)
    expect(resA.body.item).toMatchObject({ checked: true, checked_by: A })
    expect(resB.body.item).toMatchObject({ checked: false, checked_by: null, checked_at: null })
    const final = await prisma.listItem.findUniqueOrThrow({ where: { id: ITEM } })
    expect(final.checked).toBe(false)
  })

  it('the reverse order converges the other way', async () => {
    const [resB, resA] = await contended(
      () => lib.updateListItem(prisma, { itemId: ITEM, checked: false }, user(B)),
      () => lib.updateListItem(prisma, { itemId: ITEM, checked: true }, user(A))
    )
    expect(resB.body.item.checked).toBe(false)
    expect(resA.body.item).toMatchObject({ checked: true, checked_by: A })
    expect((await prisma.listItem.findUniqueOrThrow({ where: { id: ITEM } })).checked).toBe(true)
  })

  it('two concurrent ticks to the same state write once and keep the first attribution', async () => {
    const [resA, resB] = await contended(
      () => lib.updateListItem(prisma, { itemId: ITEM, checked: true }, user(A)),
      () => lib.updateListItem(prisma, { itemId: ITEM, checked: true }, user(B))
    )
    expect(resA.body.item).toMatchObject({ checked: true, checked_by: A })
    expect(resB.body.item).toMatchObject({ checked: true, checked_by: A })
    expect(new Date(resB.body.item.checked_at).getTime()).toBe(new Date(resA.body.item.checked_at).getTime())
    const final = await prisma.listItem.findUniqueOrThrow({ where: { id: ITEM } })
    expect(final.checked_by).toBe(A)
  })

  it('many interleaved requests: every response equals its desired state and the item ends consistent', async () => {
    const wants = Array.from({ length: 12 }, (_, i) => i % 2 === 0)
    const results = await Promise.all(
      wants.map((checked, i) => lib.updateListItem(prisma, { itemId: ITEM, checked }, user(i % 3 === 0 ? A : B)))
    )
    results.forEach((r, i) => {
      expect(r.status).toBe(200)
      expect((r.body as any).item.checked).toBe(wants[i])
    })
    const final = await prisma.listItem.findUniqueOrThrow({ where: { id: ITEM } })
    expect(final.checked_by === null).toBe(!final.checked)
  })
})
