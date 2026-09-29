// Consume / discard / undo (#158/#121) against real Postgres: the real Prisma
// client, DATE and TIMESTAMP(3) columns, the unique request_id, foreign keys
// and cascades, with only the session token check and next/server replaced.
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

describeWithDatabase('inventory consume / discard / undo against Postgres', () => {
  let prisma: NonNullable<typeof import('@/lib/prisma').prisma>
  let collection: typeof import('../route')
  let item: typeof import('../[id]/route')
  let consumeRoute: typeof import('../[id]/consume/route')
  let discardRoute: typeof import('../[id]/discard/route')
  let undoRoute: typeof import('../adjustments/[id]/undo/route')
  let historyRoute: typeof import('../adjustments/route')
  let useSoon: typeof import('../use-soon/route')

  const FAM = 'invadj-family'
  const FAM2 = 'invadj-family-2'
  const PARENT = 'invadj-parent'
  const TEEN = 'invadj-teen'
  const CHILD = 'invadj-child'
  const OTHER = 'invadj-other'
  const ON = { inventory: true }

  const utcPlus = (n: number) => {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() + n)
    return d.toISOString().slice(0, 10)
  }

  function request(as: string, body?: unknown, query: Record<string, string> = {}, headers: Record<string, string> = {}): any {
    const url = new URL('http://localhost/api/inventory')
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
    return {
      method: 'POST',
      url: url.toString(),
      nextUrl: url,
      headers: new Headers(headers),
      cookies: { get: (n: string) => (n === 'session_token' ? { value: `session:${as}` } : undefined) },
      json: async () => body,
      text: async () => (body === undefined ? '' : JSON.stringify(body)),
    }
  }
  const P = (id: string) => ({ params: Promise.resolve({ id }) })
  const key = (n: number) => `invadj-key-${String(n).padStart(12, '0')}`

  async function cleanup() {
    await prisma.idempotencyRecord.deleteMany({ where: { family_id: { in: [FAM, FAM2] } } })
    await prisma.family.deleteMany({ where: { id: { in: [FAM, FAM2] } } })
    await prisma.user.deleteMany({ where: { id: { in: [PARENT, TEEN, CHILD, OTHER] } } })
  }

  async function newItem(as: string, body: Record<string, unknown>) {
    const res = await collection.POST(request(as, body))
    expect(res.status).toBe(201)
    return (await res.json()).item
  }

  beforeAll(async () => {
    const mod = await import('@/lib/prisma')
    if (!mod.prisma) throw new Error('Integration database is not configured')
    prisma = mod.prisma
    collection = await import('../route')
    item = await import('../[id]/route')
    consumeRoute = await import('../[id]/consume/route')
    discardRoute = await import('../[id]/discard/route')
    undoRoute = await import('../adjustments/[id]/undo/route')
    historyRoute = await import('../adjustments/route')
    useSoon = await import('../use-soon/route')
    await cleanup()
    await prisma.family.createMany({
      data: [
        { id: FAM, name: 'ADJ', invite_code: 'invadj-invite', features: ON },
        { id: FAM2, name: 'ADJ 2', invite_code: 'invadj-invite-2', features: ON },
      ],
    })
    await prisma.user.createMany({
      data: [
        { id: PARENT, email: 'p@invadj.test', name: 'P', role: 'parent', family_id: FAM },
        { id: TEEN, email: 't@invadj.test', name: 'T', role: 'teen', family_id: FAM },
        { id: CHILD, email: 'c@invadj.test', name: 'C', role: 'child', family_id: FAM },
        { id: OTHER, email: 'o@invadj.test', name: 'O', role: 'parent', family_id: FAM2 },
      ],
    })
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  it('a row written without the #158 columns reads as an active best-before item', async () => {
    await prisma.$executeRaw`INSERT INTO "InventoryItem" (id, family_id, name, location, expires_on)
      VALUES ('invadj-legacy', ${FAM}, 'Legacy jam', 'pantry', ${utcPlus(-1)}::date)`
    const row = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: 'invadj-legacy' } })
    expect(row).toMatchObject({ date_kind: 'best_before', status: 'active', category: null, purchased_on: null, opened_on: null, finished_at: null })
    const res = await item.GET(request(CHILD), P('invadj-legacy'))
    expect((await res.json()).item.expiry).toEqual({ status: 'expired', daysLeft: -1 })
    await prisma.inventoryItem.delete({ where: { id: 'invadj-legacy' } })
  })

  it('consume part, consume the rest, undo, discard: state, history and use-soon stay consistent', async () => {
    const milk = await newItem(TEEN, { name: 'Invadj milk', amount: 2, unit: 'L', expires_on: utcPlus(1), date_kind: 'use_by', category: 'dairy_eggs', opened_on: utcPlus(-1) })
    expect(milk).toMatchObject({ date_kind: 'use_by', category: 'dairy_eggs', opened_on: utcPlus(-1), status: 'active' })
    const [raw] = await prisma.$queryRaw<Array<{ d: string }>>`SELECT to_char("opened_on", 'YYYY-MM-DD') AS d FROM "InventoryItem" WHERE id = ${milk.id}`
    expect(raw.d).toBe(utcPlus(-1))

    const part = await consumeRoute.POST(request(TEEN, { amount: 0.5 }), P(milk.id))
    expect(part.status).toBe(200)
    const partBody = await part.json()
    expect(partBody.item).toMatchObject({ status: 'active', amount: 1.5 })
    const soon1 = await (await useSoon.GET(request(CHILD))).json()
    expect(soon1.items.map((i: any) => [i.name, i.label])).toEqual([['Invadj milk', 'Use by tomorrow']])

    const rest = await (await consumeRoute.POST(request(PARENT, {}), P(milk.id))).json()
    expect(rest.item).toMatchObject({ status: 'consumed', amount: 1.5 })
    expect(rest.item.finished_at).toEqual(expect.any(String))
    expect((await (await collection.GET(request(CHILD))).json()).items.map((i: any) => i.id)).not.toContain(milk.id)
    expect((await (await useSoon.GET(request(CHILD))).json()).items).toEqual([])

    // Only the latest change can be undone.
    const older = await undoRoute.POST(request(PARENT), P(partBody.adjustment.id))
    expect(older.status).toBe(409)
    expect((await older.json()).error.code).toBe('INVENTORY_UNDO_CONFLICT')
    const undone = await (await undoRoute.POST(request(TEEN), P(rest.adjustment.id))).json()
    expect(undone.item).toMatchObject({ status: 'active', amount: 1.5, finished_at: null })

    const thrown = await (await discardRoute.POST(request(PARENT), P(milk.id))).json()
    expect(thrown.item.status).toBe('discarded')

    const rows = await prisma.inventoryAdjustment.findMany({ where: { item_id: milk.id }, orderBy: { created_at: 'asc' } })
    expect(rows.map((r) => [r.kind, r.status_after, r.amount_delta, r.actor_id, r.undone_at !== null])).toEqual([
      ['consume', 'active', -0.5, TEEN, false],
      ['consume', 'consumed', -1.5, PARENT, true],
      ['discard', 'discarded', -1.5, PARENT, false],
    ])
    expect(rows[1].undone_by).toBe(TEEN)
    expect(new Set(rows.map((r) => r.family_id))).toEqual(new Set([FAM]))

    const history = await (await historyRoute.GET(request(CHILD, undefined, { itemId: milk.id }))).json()
    expect(history.adjustments.map((a: any) => a.kind)).toEqual(['discard', 'consume', 'consume'])
    expect(history.adjustments[0]).toMatchObject({ item_name: 'Invadj milk', item_status: 'discarded' })
    expect(JSON.stringify(history)).not.toContain(FAM)
  })

  it('two households and roles: foreign ids answer like missing ones; a child is 403; nothing is written', async () => {
    const theirs = await newItem(OTHER, { name: 'Invadj other bread', amount: 1 })
    const theirAdj = await (await consumeRoute.POST(request(OTHER, {}), P(theirs.id))).json()
    const before = await prisma.inventoryAdjustment.count()

    const foreign = await consumeRoute.POST(request(PARENT, {}), P(theirs.id))
    const missing = await consumeRoute.POST(request(PARENT, {}), P('invadj-missing'))
    expect(foreign.status).toBe(404)
    expect(await foreign.json()).toEqual(await missing.json())
    expect((await discardRoute.POST(request(TEEN), P(theirs.id))).status).toBe(404)
    const foreignUndo = await undoRoute.POST(request(PARENT), P(theirAdj.adjustment.id))
    expect(foreignUndo.status).toBe(404)
    expect((await foreignUndo.json()).error.code).toBe('INVENTORY_ADJUSTMENT_NOT_FOUND')
    const mine = await newItem(PARENT, { name: 'Invadj child test' })
    expect((await consumeRoute.POST(request(CHILD, {}), P(mine.id))).status).toBe(403)
    expect((await discardRoute.POST(request(CHILD), P(mine.id))).status).toBe(403)
    expect((await undoRoute.POST(request(CHILD), P(theirAdj.adjustment.id))).status).toBe(403)
    expect(await prisma.inventoryAdjustment.count()).toBe(before)
    expect((await prisma.inventoryItem.findUniqueOrThrow({ where: { id: theirs.id } })).status).toBe('consumed')
    const ownHistory = await (await historyRoute.GET(request(PARENT))).json()
    expect(ownHistory.adjustments.map((a: any) => a.item_id)).not.toContain(theirs.id)
  })

  it('retries with the same Idempotency-Key replay: one adjustment, one state change, request_id stamped', async () => {
    const eggs = await newItem(PARENT, { name: 'Invadj eggs', amount: 12 })
    const k = key(1)
    const results = await Promise.all([
      consumeRoute.POST(request(PARENT, { amount: 2 }, {}, { 'Idempotency-Key': k }), P(eggs.id)),
      consumeRoute.POST(request(PARENT, { amount: 2 }, {}, { 'Idempotency-Key': k }), P(eggs.id)),
    ])
    // Concurrent duplicates: one runs, the other is replayed or told to retry.
    expect(results.map((r) => r.status).sort()).toEqual(expect.arrayContaining([200]))
    for (const r of results) expect([200, 409]).toContain(r.status)
    const again = await consumeRoute.POST(request(PARENT, { amount: 2 }, {}, { 'Idempotency-Key': k }), P(eggs.id))
    expect(again.status).toBe(200)
    expect(again.headers.get('Idempotency-Replayed')).toBe('true')
    const adj = await prisma.inventoryAdjustment.findMany({ where: { item_id: eggs.id } })
    expect(adj).toHaveLength(1)
    expect((await prisma.inventoryItem.findUniqueOrThrow({ where: { id: eggs.id } })).amount).toBe(10)
    const record = await prisma.idempotencyRecord.findFirstOrThrow({ where: { scope: `user:${PARENT}`, key: k } })
    expect(record).toMatchObject({ family_id: FAM, action: 'inventory-item.consume', response_status: 200 })
    expect(adj[0].request_id).toBe(record.id)

    // A re-run of the same request (crash after commit) converges on the stored row.
    const { adjustInventoryItem } = await import('@/lib/inventory-adjust')
    const rerun = await adjustInventoryItem(prisma, { familyId: FAM, itemId: eggs.id, actorId: PARENT, kind: 'consume', amount: 2, requestId: record.id })
    expect(rerun.ok && rerun.replayed).toBe(true)
    expect(await prisma.inventoryAdjustment.count({ where: { item_id: eggs.id } })).toBe(1)
    // The unique index is the backstop.
    await expect(
      prisma.inventoryAdjustment.create({
        data: { family_id: FAM, item_id: eggs.id, kind: 'consume', status_before: 'active', status_after: 'active', request_id: record.id },
      })
    ).rejects.toMatchObject({ code: 'P2002' })

    // PATCH and DELETE replay too.
    const pk = key(2)
    expect((await item.PATCH({ ...request(PARENT, { location: 'pantry' }, {}, { 'Idempotency-Key': pk }), method: 'PATCH' }, P(eggs.id))).status).toBe(200)
    const p2 = await item.PATCH({ ...request(PARENT, { location: 'pantry' }, {}, { 'Idempotency-Key': pk }), method: 'PATCH' }, P(eggs.id))
    expect(p2.headers.get('Idempotency-Replayed')).toBe('true')
    const dk = key(3)
    expect((await item.DELETE({ ...request(PARENT, undefined, {}, { 'Idempotency-Key': dk }), method: 'DELETE' }, P(eggs.id))).status).toBe(200)
    const d2 = await item.DELETE({ ...request(PARENT, undefined, {}, { 'Idempotency-Key': dk }), method: 'DELETE' }, P(eggs.id))
    expect(d2.status).toBe(200)
    expect(d2.headers.get('Idempotency-Replayed')).toBe('true')
    // Deleting the item removed its history (FK cascade).
    expect(await prisma.inventoryAdjustment.count({ where: { item_id: eggs.id } })).toBe(0)
  })

  it('concurrent consumes of the same item without keys: never both finish it', async () => {
    const bread = await newItem(TEEN, { name: 'Invadj bread' })
    const results = await Promise.all([
      consumeRoute.POST(request(TEEN, {}), P(bread.id)),
      discardRoute.POST(request(PARENT), P(bread.id)),
    ])
    const statuses = results.map((r) => r.status).sort()
    expect(statuses[0]).toBe(200)
    expect([200, 409]).toContain(statuses[1])
    // Exactly one finishing adjustment exists.
    const finished = await prisma.inventoryAdjustment.count({ where: { item_id: bread.id, status_after: { not: 'active' } } })
    expect(finished).toBe(1)
  })

  it('deleting a member keeps the history (actor SET NULL); deleting the household removes it (cascade)', async () => {
    const leaver = 'invadj-leaver'
    await prisma.user.create({ data: { id: leaver, email: 'l@invadj.test', name: 'L', role: 'teen', family_id: FAM2 } })
    const soup = await newItem(leaver, { name: 'Invadj soup' })
    await discardRoute.POST(request(leaver), P(soup.id))
    await prisma.user.delete({ where: { id: leaver } })
    const kept = await prisma.inventoryAdjustment.findFirstOrThrow({ where: { item_id: soup.id } })
    expect(kept.actor_id).toBeNull()
    expect(await prisma.inventoryAdjustment.count({ where: { family_id: FAM2 } })).toBeGreaterThan(0)
    await prisma.idempotencyRecord.deleteMany({ where: { family_id: FAM2 } })
    await prisma.family.delete({ where: { id: FAM2 } })
    expect(await prisma.inventoryAdjustment.count({ where: { family_id: FAM2 } })).toBe(0)
    expect(await prisma.inventoryItem.count({ where: { family_id: FAM2 } })).toBe(0)
  })
})
