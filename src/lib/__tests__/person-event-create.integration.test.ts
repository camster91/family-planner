// Atomic event/receipt behavior against disposable Postgres (#472).
export {}
const dbSuite = process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip
jest.setTimeout(60000)
dbSuite('person event create replay integrity', () => {
  let db: NonNullable<typeof import('@/lib/prisma').prisma>
  let create: typeof import('@/lib/person-event-create').createPersonEvent
  let idem: typeof import('@/lib/idempotency')
  const family = 'event-replay-test-family'
  const user = 'event-replay-test-user'
  const input = { title: 'Synthetic event', start_time: '2026-11-01T06:30:00.000Z', event_type: 'other' as const }
  const actor = { familyId: family, userId: user, name: 'Test parent' }
  const ctx = { scope: `user:${user}`, familyId: family, userId: user, action: 'event.create' }
  const key = 'event-create-stable-key-20261010'
  beforeAll(async () => {
    db = (await import('@/lib/prisma')).prisma!
    create = (await import('@/lib/person-event-create')).createPersonEvent
    idem = await import('@/lib/idempotency')
    await db.family.deleteMany({ where: { id: family } })
    await db.user.deleteMany({ where: { id: user } })
    await db.family.create({ data: { id: family, name: 'Synthetic replay tests', invite_code: family } })
    await db.user.create({ data: { id: user, email: 'event-replay@example.test', name: actor.name, role: 'parent', family_id: family } })
    idem.idempotencyRuntime.random = () => 0.99
  })
  beforeEach(async () => {
    await db.event.deleteMany({ where: { family_id: family } })
    await db.activity.deleteMany({ where: { family_id: family } })
    await db.idempotencyRecord.deleteMany({ where: { family_id: family } })
  })
  afterAll(async () => {
    await db.family.deleteMany({ where: { id: family } })
    await db.user.deleteMany({ where: { id: user } })
    await db.$disconnect()
  })
  const run = (body = input) => idem.withIdempotency(db, key, ctx, body, ({ recordId }) => create(db, body, actor, recordId))
  it('replays the committed event after a lost response with one event and one activity', async () => {
    const first = await (await run()).json()
    const retry = await run()
    expect(retry.headers.get('Idempotency-Replayed')).toBe('true')
    expect(await retry.json()).toEqual(first)
    expect(await db.event.count({ where: { family_id: family } })).toBe(1)
    expect(await db.activity.count({ where: { family_id: family } })).toBe(1)
  })
  it('serializes overlapping original and lock-takeover effects on their receipt', async () => {
    const receipt = await db.idempotencyRecord.create({ data: {
      scope: ctx.scope, key, family_id: family, user_id: user, action: ctx.action,
      request_hash: idem.hashIdempotentRequest(ctx.action, input), expires_at: new Date(Date.now() + idem.IDEMPOTENCY_TTL_MS),
    } })
    const results = await Promise.all([create(db, input, actor, receipt.id), create(db, input, actor, receipt.id)])
    expect(results[0]).toEqual(results[1])
    expect(await db.event.count({ where: { family_id: family } })).toBe(1)
    expect(await db.activity.count({ where: { family_id: family } })).toBe(1)
  })
  it('refuses changed payload using the existing canonical replay conflict code', async () => {
    await run()
    const changed = await run({ ...input, title: 'Changed event' })
    expect(changed.status).toBe(422)
    expect((await changed.json()).error.code).toBe('IDEMPOTENCY_KEY_REUSED')
    expect(await db.event.count({ where: { family_id: family } })).toBe(1)
  })
  it('never exposes a receipt to a changed household', async () => {
    await run()
    const changed = await idem.withIdempotency(db, key, { ...ctx, familyId: 'foreign-family' }, input, () => { throw new Error('must not execute') })
    expect(changed.status).toBe(422)
    expect((await changed.json()).event).toBeUndefined()
  })
  it('rolls back the event and activity when receipt completion fails', async () => {
    const receipt = await db.idempotencyRecord.create({ data: {
      scope: ctx.scope, key, family_id: family, user_id: user, action: ctx.action,
      request_hash: idem.hashIdempotentRequest(ctx.action, input), expires_at: new Date(Date.now() + idem.IDEMPOTENCY_TTL_MS),
    } })
    const failingDb = {
      $executeRaw: db.$executeRaw.bind(db),
      $transaction: ((callback: any) => db.$transaction(async (tx) => callback(new Proxy(tx, {
        get(target, property) {
          if (property === 'idempotencyRecord') return { ...target.idempotencyRecord, update: async () => { throw new Error('completion write failed') } }
          return Reflect.get(target, property)
        },
      })))) as typeof db.$transaction,
    }
    await expect(create(failingDb, input, actor, receipt.id)).rejects.toThrow('completion write failed')
    expect(await db.event.count({ where: { family_id: family } })).toBe(0)
    expect(await db.activity.count({ where: { family_id: family } })).toBe(0)
  })
  it('replays without resurrecting an event subsequently deleted', async () => {
    const saved = await (await run()).json()
    await db.event.delete({ where: { id: saved.event.id } })
    expect(await (await run()).json()).toEqual(saved)
    expect(await db.event.count({ where: { family_id: family } })).toBe(0)
  })
  it('keeps deliberate legacy requests distinct', async () => {
    await create(db, input, actor, null)
    await create(db, input, actor, null)
    expect(await db.event.count({ where: { family_id: family } })).toBe(2)
  })
})
