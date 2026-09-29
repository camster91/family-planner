// Shared-tablet writes (#274) against real Postgres: the relation-filtered
// item lookup, the idempotency unique index under a replay, the JSON audit
// metadata the tablet Undo reads back, the `Family.device_writes_enabled`
// column and two-household isolation. Only next/server is replaced.
// Opt-in like the other integration suites: RUN_DB_INTEGRATION=1
// DATABASE_URL=... against a disposable database that `node scripts/migrate.js`
// has prepared.

jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)

export {}

const describeWithDatabase = process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip

jest.setTimeout(60_000)

describeWithDatabase('shared-tablet writes against Postgres', () => {
  let prisma: NonNullable<typeof import('@/lib/prisma').prisma>
  let tick: typeof import('../lists/items/[id]/route')
  let add: typeof import('../lists/[id]/items/route')
  let complete: typeof import('../chores/[id]/complete/route')
  let undo: typeof import('../chores/[id]/uncomplete/route')
  let access1 = ''
  let access2 = ''

  const FAM = 'dwint-family'
  const FAM2 = 'dwint-family-2'
  const PARENT = 'dwint-parent'
  const CHILD = 'dwint-child'
  const OTHER = 'dwint-other'
  const LIST = 'dwint-list'
  const LIST2 = 'dwint-list-2'
  const ITEM = 'dwint-item'
  const ITEM2 = 'dwint-item-2'
  const CHORE = 'dwint-chore'
  const CHORE2 = 'dwint-chore-2'
  let seq = 0
  const key = () => `dwint-key-${String(++seq).padStart(4, '0')}-abcdef`

  function request(access: string, body: unknown, k: string | null = key()): any {
    const url = new URL('http://localhost/api/device/test')
    return {
      method: 'POST',
      url: url.toString(),
      nextUrl: url,
      headers: new Headers(k ? { 'Idempotency-Key': k } : {}),
      cookies: { get: (n: string) => (n === 'fp_device' ? { value: access } : undefined) },
      json: async () => body,
    }
  }
  const params = (id: string) => ({ params: Promise.resolve({ id }) })

  async function cleanup() {
    await prisma.idempotencyRecord.deleteMany({ where: { family_id: { in: [FAM, FAM2] } } })
    await prisma.family.deleteMany({ where: { id: { in: [FAM, FAM2] } } })
    await prisma.user.deleteMany({ where: { id: { in: [PARENT, CHILD, OTHER] } } })
  }

  beforeAll(async () => {
    process.env.SHARED_DEVICE_ENABLED = 'true'
    const mod = await import('@/lib/prisma')
    if (!mod.prisma) throw new Error('Integration database is not configured')
    prisma = mod.prisma
    const session = await import('@/lib/device-session')
    tick = await import('../lists/items/[id]/route')
    add = await import('../lists/[id]/items/route')
    complete = await import('../chores/[id]/complete/route')
    undo = await import('../chores/[id]/uncomplete/route')
    await cleanup()
    await prisma.family.createMany({
      data: [
        { id: FAM, name: 'Writes Int', invite_code: 'dwint-invite' },
        { id: FAM2, name: 'Writes Int 2', invite_code: 'dwint-invite-2' },
      ],
    })
    await prisma.user.createMany({
      data: [
        { id: PARENT, email: 'p@dwint.test', name: 'Pat Parent', role: 'parent', family_id: FAM },
        { id: CHILD, email: 'c@dwint.test', name: 'Casey Child', role: 'child', family_id: FAM },
        { id: OTHER, email: 'o@dwint.test', name: 'Other Parent', role: 'parent', family_id: FAM2 },
      ],
    })
    await prisma.list.createMany({
      data: [
        { id: LIST, family_id: FAM, name: 'Groceries', type: 'grocery', created_by: PARENT },
        { id: LIST2, family_id: FAM2, name: 'Groceries', type: 'grocery', created_by: OTHER },
      ],
    })
    const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z')
    await prisma.chore.createMany({
      data: [
        { id: CHORE, family_id: FAM, title: 'Feed the cat', assigned_to: CHILD, due_date: today, created_by: PARENT },
        { id: CHORE2, family_id: FAM2, title: 'Other chore', assigned_to: OTHER, due_date: today, created_by: OTHER },
      ],
    })
    for (const [fam, set] of [
      [FAM, (t: string) => (access1 = t)],
      [FAM2, (t: string) => (access2 = t)],
    ] as const) {
      const d = await prisma.householdDevice.create({
        data: { family_id: fam, label: 'Kitchen', platform: 'web' },
        select: { id: true },
      })
      set((await session.createDeviceSession(prisma, d.id, fam, new Date())).accessToken)
    }
  })

  afterAll(async () => {
    await cleanup()
    delete process.env.SHARED_DEVICE_ENABLED
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.listItem.deleteMany({ where: { list_id: { in: [LIST, LIST2] } } })
    await prisma.listItem.createMany({
      data: [
        { id: ITEM, list_id: LIST, content: 'Milk', added_by: PARENT },
        { id: ITEM2, list_id: LIST2, content: 'Other milk', added_by: OTHER },
      ],
    })
    await prisma.chore.updateMany({ where: { id: { in: [CHORE, CHORE2] } }, data: { status: 'pending', completed_at: null } })
    await prisma.family.updateMany({ where: { id: { in: [FAM, FAM2] } }, data: { device_writes_enabled: true } })
  })

  it('the column defaults off and gates every write', async () => {
    const created = await prisma.family.create({ data: { name: 'Default', invite_code: 'dwint-default' } })
    expect(created.device_writes_enabled).toBe(false)
    await prisma.family.delete({ where: { id: created.id } })

    await prisma.family.update({ where: { id: FAM }, data: { device_writes_enabled: false } })
    const res = await tick.PATCH(request(access1, { checked: true, actingMemberId: CHILD }), params(ITEM))
    expect(res.status).toBe(403)
    expect((await prisma.listItem.findUnique({ where: { id: ITEM } }))!.checked).toBe(false)
  })

  it('ticks once per key, attributed to the member, isolated by household, audited with JSON metadata', async () => {
    const k = key()
    const first = await tick.PATCH(request(access1, { checked: true, actingMemberId: CHILD }, k), params(ITEM))
    expect(first.status).toBe(200)
    const again = await tick.PATCH(request(access1, { checked: true, actingMemberId: CHILD }, k), params(ITEM))
    expect(again.headers.get('Idempotency-Replayed')).toBe('true')
    expect(await prisma.listItem.findUnique({ where: { id: ITEM } })).toMatchObject({ checked: true, checked_by: CHILD })
    const events = await prisma.deviceAuditEvent.findMany({ where: { family_id: FAM, type: 'device.member_action' } })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ actor_user_id: CHILD, metadata: { action: 'list_item_check', targetId: ITEM } })

    const foreign = await tick.PATCH(request(access1, { checked: true, actingMemberId: CHILD }), params(ITEM2))
    expect(foreign.status).toBe(404)
    const foreignMember = await tick.PATCH(request(access1, { checked: true, actingMemberId: OTHER }), params(ITEM))
    expect(foreignMember.status).toBe(400)
    expect((await prisma.listItem.findUnique({ where: { id: ITEM2 } }))!.checked).toBe(false)
  })

  it('quick add writes one row to the household list only', async () => {
    const k = key()
    const res = await add.POST(request(access1, { content: 'Eggs', actingMemberId: CHILD }, k), params(LIST))
    expect(res.status).toBe(201)
    await add.POST(request(access1, { content: 'Eggs', actingMemberId: CHILD }, k), params(LIST))
    expect(await prisma.listItem.count({ where: { list_id: LIST, content: 'Eggs', added_by: CHILD } })).toBe(1)
    const foreign = await add.POST(request(access2, { content: 'Eggs', actingMemberId: OTHER }), params(LIST))
    expect(foreign.status).toBe(404)
  })

  it('quick add converges after a lock takeover: the stored record id finds the committed row', async () => {
    const k = key()
    const first = await add.POST(request(access1, { content: 'Butter', actingMemberId: CHILD }, k), params(LIST))
    expect(first.status).toBe(201)
    const firstBody = await first.json()
    // As if the first run died after committing the row but before storing its answer.
    await prisma.idempotencyRecord.updateMany({
      where: { key: k },
      data: { response_status: null, response_body: undefined, created_at: new Date(Date.now() - 60_000) },
    })
    const retry = await add.POST(request(access1, { content: 'Butter', actingMemberId: CHILD }, k), params(LIST))
    expect(retry.status).toBe(201)
    expect(await retry.json()).toEqual(firstBody)
    expect(await prisma.listItem.count({ where: { list_id: LIST, content: 'Butter' } })).toBe(1)
  })

  it('completes a chore due today and the same tablet can undo it; the other household cannot touch it', async () => {
    const foreign = await complete.POST(request(access2, { actingMemberId: OTHER }), params(CHORE))
    expect(foreign.status).toBe(404)

    const res = await complete.POST(request(access1, { actingMemberId: CHILD }), params(CHORE))
    expect(res.status).toBe(200)
    expect((await prisma.chore.findUnique({ where: { id: CHORE } }))!.status).toBe('completed')
    expect(await prisma.activity.count({ where: { family_id: FAM, user_id: CHILD, type: 'chore_completed' } })).toBe(1)

    const otherUndo = await undo.POST(request(access2, { actingMemberId: OTHER }), params(CHORE))
    expect(otherUndo.status).toBe(404)
    const back = await undo.POST(request(access1, { actingMemberId: CHILD }), params(CHORE))
    expect(back.status).toBe(200)
    expect((await prisma.chore.findUnique({ where: { id: CHORE } }))!.status).toBe('pending')
  })
})
