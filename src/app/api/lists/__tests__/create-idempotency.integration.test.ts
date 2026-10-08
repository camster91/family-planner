// Real PostgreSQL proof of keyed personal creates, atomic completion and lock
// takeover. The fake route harness cannot prove rollback or row lock behaviour.
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

import { Client } from 'pg'
const describeDb = process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip
jest.setTimeout(60_000)

describeDb('personal list create against Postgres', () => {
  let prisma: NonNullable<typeof import('@/lib/prisma').prisma>
  let POST: typeof import('../items/create/route').POST
  let groceryPOST: typeof import('../items/grocery-add/route').POST
  let idem: typeof import('@/lib/idempotency')
  let effect: typeof import('@/lib/person-list-item-create').createPersonListItem
  const FAM = 'pcint-family', OTHER = 'pcint-other-family'
  const A = 'pcint-parent', B = 'pcint-teen', C = 'pcint-other'
  const LIST = 'pcint-list', FOREIGN_LIST = 'pcint-foreign-list'
  const KEY = '33333333-3333-4333-8333-333333333333'
  const BODY = { listId: LIST, content: 'Milk', quantity: 1 }
  const ctx = { scope: `user:${A}`, familyId: FAM, userId: A, action: 'list-item.add' }
  let now: Date
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  function request(as: string | null, body: unknown = BODY, key: string | null = KEY): any {
    return {
      headers: new Headers(key ? { 'Idempotency-Key': key } : {}),
      cookies: { get: (name: string) => as && name === 'session_token' ? { value: `session:${as}` } : undefined },
      json: async () => body,
    }
  }
  async function cleanup() {
    await prisma.family.deleteMany({ where: { id: { in: [FAM, OTHER] } } })
    await prisma.user.deleteMany({ where: { id: { in: [A, B, C] } } })
  }
  beforeAll(async () => {
    prisma = (await import('@/lib/prisma')).prisma!
    if (!prisma) throw Error('Integration database required')
    POST = (await import('../items/create/route')).POST
    groceryPOST = (await import('../items/grocery-add/route')).POST
    idem = await import('@/lib/idempotency')
    effect = (await import('@/lib/person-list-item-create')).createPersonListItem
    await cleanup()
    await prisma.family.createMany({ data: [
      { id: FAM, name: 'Personal create test', invite_code: 'pcint-invite' },
      { id: OTHER, name: 'Other test household', invite_code: 'pcint-other-invite' },
    ] })
    await prisma.user.createMany({ data: [
      { id: A, email: 'a@pcint.test', name: 'A', role: 'parent', family_id: FAM },
      { id: B, email: 'b@pcint.test', name: 'B', role: 'teen', family_id: FAM },
      { id: C, email: 'c@pcint.test', name: 'C', role: 'parent', family_id: OTHER },
    ] })
    await prisma.list.createMany({ data: [
      { id: LIST, family_id: FAM, name: 'Groceries', type: 'grocery', created_by: A },
      { id: FOREIGN_LIST, family_id: OTHER, name: 'Other groceries', type: 'grocery', created_by: C },
    ] })
    await prisma.ingredient.create({ data: { id: 'pcint-foreign-ingredient', name: 'Other', family_id: OTHER } })
  })
  beforeEach(async () => {
    await prisma.listItem.deleteMany({ where: { list_id: { in: [LIST, FOREIGN_LIST] } } })
    await prisma.idempotencyRecord.deleteMany({ where: { family_id: { in: [FAM, OTHER] } } })
    now = new Date(); idem.idempotencyRuntime.now = () => now; idem.idempotencyRuntime.random = () => 0.99
  })
  afterAll(async () => {
    idem.idempotencyRuntime.now = () => new Date(); idem.idempotencyRuntime.random = () => Math.random()
    await cleanup(); await prisma.$disconnect()
  })

  it('strict grocery creates converge under concurrent replay and do not resurrect a deleted item', async () => {
    const body = { listId: LIST, content: 'Queued grocery' }
    const responses = await Promise.all(Array.from({ length: 8 }, () => groceryPOST(request(A, body))))
    expect(responses.every(r => r.status === 200 || r.status === 409)).toBe(true)
    const replay = await groceryPOST(request(A, body)); expect(replay.status).toBe(200)
    const first = await replay.json()
    expect(await prisma.listItem.count({ where: { list_id: LIST } })).toBe(1)
    await prisma.listItem.delete({ where: { id: first.item.id } })
    const deletedReplay = await groceryPOST(request(A, body))
    expect(deletedReplay.headers.get('Idempotency-Replayed')).toBe('true')
    expect(await deletedReplay.json()).toEqual(first)
    expect(await prisma.listItem.count({ where: { list_id: LIST } })).toBe(0)
  })

  it('grocery type is rechecked under the write lock after a concurrent list change', async () => {
    const holder = new Client({ connectionString: process.env.DATABASE_URL }); await holder.connect()
    let requestPromise: Promise<any> | undefined
    try {
      await holder.query('BEGIN'); await holder.query('UPDATE "List" SET "type" = $1 WHERE "id" = $2', ['todo', LIST])
      requestPromise = groceryPOST(request(A, { listId: LIST, content: 'Stale grocery add' }))
      for (let i = 0; i < 50; i++) {
        if (await prisma.idempotencyRecord.count({ where: { scope: ctx.scope, key: KEY } })) break
        await sleep(20)
      }
      expect(await prisma.idempotencyRecord.count({ where: { scope: ctx.scope, key: KEY } })).toBe(1)
      await holder.query('COMMIT')
      expect((await requestPromise).status).toBe(404)
      expect(await prisma.listItem.count({ where: { list_id: LIST } })).toBe(0)
    } finally {
      await holder.query('ROLLBACK'); await holder.end()
      await Promise.allSettled(requestPromise ? [requestPromise] : [])
      await prisma.list.update({ where: { id: LIST }, data: { type: 'grocery' } })
    }
  })

  it('eight concurrent duplicates create one row and replay its exact response', async () => {
    const responses = await Promise.all(Array.from({ length: 8 }, () => POST(request(A))))
    expect(responses.every((r) => r.status === 200 || r.status === 409)).toBe(true)
    expect(await prisma.listItem.count({ where: { list_id: LIST } })).toBe(1)
    const first = responses.find((r) => r.status === 200)!
    const replay = await POST(request(A))
    expect(replay.headers.get('Idempotency-Replayed')).toBe('true')
    expect(await replay.json()).toEqual(await first.json())
    const row = await prisma.idempotencyRecord.findFirstOrThrow({ where: { scope: ctx.scope, key: KEY } })
    expect(row.response_status).toBe(200)
    expect((await prisma.listItem.findFirstOrThrow({ where: { list_id: LIST } })).source_request_id).toBe(row.id)
  })

  it('different user scopes and distinct deliberate keys make distinct attributed adds', async () => {
    await POST(request(A)); await POST(request(B)); await POST(request(A, BODY, KEY + '-second'))
    await POST(request(C, { ...BODY, listId: FOREIGN_LIST }))
    expect(await prisma.listItem.count({ where: { list_id: LIST, added_by: A } })).toBe(2)
    expect(await prisma.listItem.count({ where: { list_id: LIST, added_by: B } })).toBe(1)
    expect(await prisma.listItem.count({ where: { list_id: FOREIGN_LIST, added_by: C } })).toBe(1)
  })

  it('refuses key reuse and invalid/foreign requests without extra rows', async () => {
    await POST(request(A))
    expect((await POST(request(A, { ...BODY, content: 'Rice' }))).status).toBe(422)
    expect((await POST(request(C))).status).toBe(403)
    expect((await POST(request(null))).status).toBe(401)
    expect((await POST(request(A, { ...BODY, ingredient_id: 'pcint-foreign-ingredient' }, KEY + '-foreign'))).status).toBe(400)
    expect(await prisma.listItem.count({ where: { list_id: LIST } })).toBe(1)
  })

  it('no-header clients keep distinct adds and their previous 200 response', async () => {
    expect((await POST(request(A, BODY, null))).status).toBe(200)
    expect((await POST(request(A, BODY, null))).status).toBe(200)
    expect(await prisma.listItem.count({ where: { list_id: LIST } })).toBe(2)
    expect(await prisma.idempotencyRecord.count({ where: { family_id: FAM } })).toBe(0)
  })

  it('deleted items are not resurrected by replay of their original add', async () => {
    const first = await POST(request(A)); const response = await first.json()
    await prisma.listItem.delete({ where: { id: response.item.id } })
    const replay = await POST(request(A))
    expect(replay.headers.get('Idempotency-Replayed')).toBe('true')
    expect(await replay.json()).toEqual(response)
    expect(await prisma.listItem.count({ where: { list_id: LIST } })).toBe(0)
  })

  it('completion-store failure rolls the actual item transaction back; retry creates once', async () => {
    // Fault at the exact transactional completion write, after createListItem
    // has inserted and resolved its section. PostgreSQL must roll both back.
    const failingDb: any = { $transaction: (fn: any) => prisma.$transaction((tx) => fn(new Proxy(tx, {
      get(target, prop) {
        if (prop === 'idempotencyRecord') return new Proxy(target.idempotencyRecord, {
          get(delegate, method) { return method === 'update' ? async () => { throw Error('completion unavailable') } : Reflect.get(delegate, method) },
        })
        return Reflect.get(target, prop)
      },
    }))) }
    await expect(idem.withIdempotency(prisma, KEY, ctx, BODY,
      ({ recordId }) => effect(failingDb, BODY, { familyId: FAM, addedBy: A }, recordId))).rejects.toThrow('completion unavailable')
    expect(await prisma.listItem.count({ where: { list_id: LIST } })).toBe(0)
    expect(await prisma.idempotencyRecord.count({ where: { scope: ctx.scope, key: KEY } })).toBe(0)
    expect((await POST(request(A))).status).toBe(200)
    expect(await prisma.listItem.count({ where: { list_id: LIST } })).toBe(1)
  })

  it('a failed redundant response store after commit still leaves a replayable atomic result', async () => {
    const failingOuter: any = new Proxy(prisma, {
      get(target, prop) {
        if (prop === 'idempotencyRecord') return new Proxy(target.idempotencyRecord, {
          get(delegate, method) { return method === 'update' ? async () => { throw Error('outer store unavailable') } : Reflect.get(delegate, method) },
        })
        return Reflect.get(target, prop)
      },
    })
    const first = await idem.withIdempotency(failingOuter, KEY, ctx, BODY,
      ({ recordId }) => effect(prisma, BODY, { familyId: FAM, addedBy: A }, recordId))
    expect(first.status).toBe(200)
    const replay = await POST(request(A))
    expect(replay.headers.get('Idempotency-Replayed')).toBe('true')
    expect(await replay.json()).toEqual(await first.json())
    expect(await prisma.listItem.count({ where: { list_id: LIST } })).toBe(1)
  })

  it('a takeover overlapping a slow original transaction cannot add twice', async () => {
    const holder = new Client({ connectionString: process.env.DATABASE_URL }); await holder.connect()
    let first: Promise<any> | undefined, second: Promise<any> | undefined
    try {
      await holder.query('BEGIN'); await holder.query('SELECT "id" FROM "List" WHERE "id" = $1 FOR UPDATE', [LIST])
      first = POST(request(A))
      for (let i = 0; i < 50; i++) {
        if (await prisma.idempotencyRecord.count({ where: { scope: ctx.scope, key: KEY } })) break
        await sleep(20)
      }
      expect(await prisma.idempotencyRecord.count({ where: { scope: ctx.scope, key: KEY } })).toBe(1)
      now = new Date(now.getTime() + idem.IDEMPOTENCY_LOCK_TIMEOUT_MS + 1)
      second = POST(request(A)); await sleep(100)
      await holder.query('COMMIT')
      const responses = await Promise.all([first, second])
      expect(responses.every((r) => r.status === 200 || r.status === 409)).toBe(true)
      const replay = await POST(request(A)); expect(replay.status).toBe(200)
      expect(replay.headers.get('Idempotency-Replayed')).toBe('true')
      expect(await prisma.listItem.count({ where: { list_id: LIST } })).toBe(1)
    } finally {
      await holder.query('ROLLBACK'); await holder.end()
      await Promise.allSettled([first, second].filter(Boolean) as Promise<any>[])
    }
  })
})
