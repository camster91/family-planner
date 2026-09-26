// Real-Postgres checks for the idempotency helper (#162) where the fake DB
// cannot prove the behaviour: the (scope, key) unique index serialising
// concurrent duplicates so the effect runs exactly once, the P2002 mapping
// through the pg driver adapter, and FK cascades.
// Opt-in like the other integration suites: RUN_DB_INTEGRATION=1 DATABASE_URL=...
// against a disposable database that `node scripts/migrate.js` has prepared.

export {}

const describeWithDatabase = process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip

jest.setTimeout(60_000)

describeWithDatabase('idempotency against Postgres', () => {
  let prisma: NonNullable<typeof import('@/lib/prisma').prisma>
  let lib: typeof import('@/lib/idempotency')

  const FAM = 'idemint-family'
  const FAM2 = 'idemint-family-2'
  const USER = 'idemint-user'
  const USER2 = 'idemint-user-2'
  const LIST = 'idemint-list'
  const ITEM = 'idemint-item'

  async function cleanup() {
    await prisma.family.deleteMany({ where: { id: { in: [FAM, FAM2] } } })
    await prisma.user.deleteMany({ where: { id: { in: [USER, USER2] } } })
  }

  beforeAll(async () => {
    const mod = await import('@/lib/prisma')
    if (!mod.prisma) throw new Error('Integration database is not configured')
    prisma = mod.prisma
    lib = await import('@/lib/idempotency')
    await cleanup()
    await prisma.family.createMany({
      data: [
        { id: FAM, name: 'Idem Int', invite_code: 'idemint-invite' },
        { id: FAM2, name: 'Idem Int 2', invite_code: 'idemint-invite-2' },
      ],
    })
    await prisma.user.createMany({
      data: [
        { id: USER, email: 'u@idemint.test', name: 'U', role: 'parent', family_id: FAM },
        { id: USER2, email: 'u2@idemint.test', name: 'U2', role: 'parent', family_id: FAM2 },
      ],
    })
    await prisma.list.create({ data: { id: LIST, family_id: FAM, name: 'Groceries', type: 'grocery', created_by: USER } })
    await prisma.listItem.create({ data: { id: ITEM, list_id: LIST, content: 'Milk', added_by: USER, quantity: 1 } })
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.idempotencyRecord.deleteMany({ where: { family_id: { in: [FAM, FAM2] } } })
    lib.idempotencyRuntime.random = () => 0.99
  })

  const ctx = () => ({ scope: `user:${USER}`, familyId: FAM, userId: USER, action: 'list-item.update' })

  it('concurrent duplicates with one key run the effect exactly once', async () => {
    const key = '9c1f4e0a-7a3b-4c52-9d0e-5b6a7c8d9e0f'
    let effects = 0
    const effect = async () => {
      effects += 1
      // Hold the in-progress row long enough for every duplicate to collide.
      await new Promise((r) => setTimeout(r, 200))
      await prisma.listItem.update({ where: { id: ITEM }, data: { quantity: { increment: 1 } } })
      return { status: 200, body: { success: true } }
    }
    const before = (await prisma.listItem.findUniqueOrThrow({ where: { id: ITEM } })).quantity
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => lib.withIdempotency(prisma, key, ctx(), { itemId: ITEM, checked: true }, effect))
    )
    expect(effects).toBe(1)
    // Exactly one response is the original; the rest collided while it ran
    // (409 IN_PROGRESS) or, if the pool delayed them, replayed its result.
    const original = responses.filter((r) => r.status === 200 && r.headers.get('Idempotency-Replayed') === null)
    expect(original).toHaveLength(1)
    for (const r of responses) {
      if (r === original[0]) continue
      expect(r.status === 409 || r.headers.get('Idempotency-Replayed') === 'true').toBe(true)
    }
    expect(responses.filter((r) => r.status === 409).length).toBeGreaterThan(0)
    const after = (await prisma.listItem.findUniqueOrThrow({ where: { id: ITEM } })).quantity
    expect(after).toBe(before + 1)

    // Once finished, duplicates replay the stored response.
    const replay = await lib.withIdempotency(prisma, key, ctx(), { itemId: ITEM, checked: true }, effect)
    expect(replay.status).toBe(200)
    expect(replay.headers.get('Idempotency-Replayed')).toBe('true')
    expect(effects).toBe(1)
    const rows = await prisma.idempotencyRecord.findMany({ where: { key } })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ response_status: 200, family_id: FAM, user_id: USER })
  })

  it('sequential retries after the first finished are all replays', async () => {
    const key = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
    let effects = 0
    const effect = async () => {
      effects += 1
      return { status: 200, body: { n: effects } }
    }
    for (let i = 0; i < 5; i++) {
      const res = await lib.withIdempotency(prisma, key, ctx(), { a: 1 }, effect)
      expect(await res.json()).toEqual({ n: 1 })
    }
    expect(effects).toBe(1)
  })

  it('the same key in another user scope is independent', async () => {
    const key = 'abcdefab-cdef-4abc-8def-abcdefabcdef'
    const run = (scope: string, familyId: string, userId: string) =>
      lib.withIdempotency(prisma, key, { scope, familyId, userId, action: 'x' }, {}, async () => ({ status: 200, body: { userId } }))
    await run(`user:${USER}`, FAM, USER)
    const other = await run(`user:${USER2}`, FAM2, USER2)
    expect(await other.json()).toEqual({ userId: USER2 })
    expect(await prisma.idempotencyRecord.count({ where: { key } })).toBe(2)
  })

  it('records cascade away with their user', async () => {
    const tmpUser = 'idemint-tmp'
    await prisma.user.create({ data: { id: tmpUser, email: 'tmp@idemint.test', name: 'T', role: 'teen', family_id: FAM } })
    await lib.withIdempotency(
      prisma,
      'ffffffff-ffff-4fff-8fff-ffffffffffff',
      { scope: `user:${tmpUser}`, familyId: FAM, userId: tmpUser, action: 'x' },
      {},
      async () => ({ status: 200, body: {} })
    )
    await prisma.user.delete({ where: { id: tmpUser } })
    expect(await prisma.idempotencyRecord.count({ where: { user_id: tmpUser } })).toBe(0)
  })
})
