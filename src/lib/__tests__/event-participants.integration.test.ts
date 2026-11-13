// People on events against disposable Postgres: two households, capability on and off.
import { assertFixtureTargetAllowed } from '@/lib/fixtures/guard'
import { EVENT_PEOPLE_READY_ENV } from '@/lib/event-participants'
export {}
const dbSuite = process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip
jest.setTimeout(60000)
dbSuite('people on events (Postgres)', () => {
  let db: NonNullable<typeof import('@/lib/prisma').prisma>
  let create: typeof import('@/lib/person-event-create').createPersonEvent
  let update: typeof import('@/lib/person-event-update').updatePersonEvent
  let people: typeof import('@/lib/event-participants-db')
  const A = 'people-pg-family-a', B = 'people-pg-family-b'
  const P = 'people-pg-parent', T = 'people-pg-teen', F = 'people-pg-foreign'
  const KID = 'people-pg-kid', ARCHIVED = 'people-pg-archived', FKID = 'people-pg-foreign-kid'
  const actor = { familyId: A, userId: P, name: 'Parent', tokenVersion: 0 }
  const base = { title: 'Dentist', start_time: '2026-11-20T14:00:00.000Z', end_time: '2026-11-20T15:00:00.000Z', event_type: 'appointment' as const }
  type Ref = { kind: 'account' | 'profile'; id: string }
  const make = (participants?: Ref[]) => create(db, { ...base, participants }, actor, null)
  const stored = async (eventId: string) => (await db.eventParticipant.findMany({ where: { event_id: eventId }, select: { user_id: true, member_id: true } }))
    .map((row) => row.user_id ?? row.member_id).sort()
  const eventId = (result: { body: unknown }) => (result.body as { event: { id: string } }).event.id
  const shown = (result: { body: unknown }) => (result.body as { event: { participants: Array<{ id: string }> } }).event.participants.map((p) => p.id)
  const clean = async () => {
    await db.family.deleteMany({ where: { id: { in: [A, B] } } })
    await db.user.deleteMany({ where: { id: { in: [P, T, F] } } })
  }
  beforeAll(async () => {
    assertFixtureTargetAllowed(process.env)
    db = (await import('@/lib/prisma')).prisma!
    create = (await import('@/lib/person-event-create')).createPersonEvent
    update = (await import('@/lib/person-event-update')).updatePersonEvent
    people = await import('@/lib/event-participants-db')
    await clean()
    await db.family.createMany({ data: [{ id: A, name: 'People A', invite_code: A }, { id: B, name: 'People B', invite_code: B }] })
    await db.user.createMany({ data: [
      { id: P, email: 'people-pg-parent@example.test', name: 'Parent', role: 'parent', family_id: A, board_color: 'green', created_at: new Date(1000) },
      { id: T, email: 'people-pg-teen@example.test', name: 'Teen', role: 'teen', family_id: A, created_at: new Date(2000) },
      { id: F, email: 'people-pg-foreign@example.test', name: 'PRIVATE FOREIGN NAME', role: 'parent', family_id: B, created_at: new Date(3000) },
    ] })
    await db.householdMember.createMany({ data: [
      { id: KID, family_id: A, name: 'Kid', role: 'child', created_at: new Date(4000) },
      { id: ARCHIVED, family_id: A, name: 'Archived', role: 'child', archived_at: new Date(5000), created_at: new Date(5000) },
      { id: FKID, family_id: B, name: 'PRIVATE FOREIGN KID', role: 'child', created_at: new Date(6000) },
    ] })
  })
  beforeEach(async () => {
    process.env[EVENT_PEOPLE_READY_ENV] = '1'
    await db.event.deleteMany({ where: { family_id: { in: [A, B] } } })
  })
  afterAll(async () => {
    delete process.env[EVENT_PEOPLE_READY_ENV]
    if (!db) return
    await clean()
    await db.$disconnect()
  })

  it('capability off: refuses a people list before any write and reads none', async () => {
    process.env[EVENT_PEOPLE_READY_ENV] = '0'
    const refused = await make([{ kind: 'account', id: T }])
    expect(refused).toMatchObject({ status: 409, body: { code: 'EVENT_PEOPLE_UNSUPPORTED' } })
    expect(await db.event.count({ where: { family_id: A } })).toBe(0)
    const plain = await make()
    expect(plain.status).toBe(200)
    expect((await update(db, actor, { eventId: eventId(plain), participants: [] })).status).toBe(409)
    expect((await people.projectEventParticipants(db, A, [{ id: eventId(plain) }]))[0].participants).toEqual([])
  })

  it('lists accounts then standalone profiles, with the chosen colour and distinct fallbacks', async () => {
    const list = await people.readHouseholdPeople(db, A)
    expect([...list.keys()]).toEqual([`account:${P}`, `account:${T}`, `profile:${KID}`])
    expect(list.get(`account:${P}`)!.color).toBe('green')
    expect(new Set([...list.values()].map((p) => p.color)).size).toBe(3)
  })

  it('creates with an account and a profile and returns them in household order', async () => {
    const made = await make([{ kind: 'profile', id: KID }, { kind: 'account', id: T }])
    expect(made.status).toBe(200)
    expect(shown(made)).toEqual([T, KID])
    expect(await stored(eventId(made))).toEqual([KID, T].sort())
  })

  it.each([
    ['a foreign account', { kind: 'account' as const, id: F }],
    ['a foreign profile', { kind: 'profile' as const, id: FKID }],
    ['an archived profile', { kind: 'profile' as const, id: ARCHIVED }],
    ['an unknown account', { kind: 'account' as const, id: 'people-pg-missing' }],
  ])('refuses %s whole, on create and on PATCH', async (_label, bad) => {
    const refused = await make([{ kind: 'account', id: T }, bad])
    expect(refused).toMatchObject({ status: 400, body: { code: 'EVENT_PEOPLE_INVALID' } })
    expect(JSON.stringify(refused)).not.toContain('PRIVATE')
    expect(await db.event.count({ where: { family_id: A } })).toBe(0)
    const event = eventId(await make([{ kind: 'account', id: P }]))
    const patch = await update(db, actor, { eventId: event, title: 'Must not save', participants: [bad] })
    expect(patch).toMatchObject({ status: 400, body: { code: 'EVENT_PEOPLE_INVALID' } })
    expect((await db.event.findUnique({ where: { id: event } }))!.title).toBe('Dentist')
    expect(await stored(event)).toEqual([P])
  })

  it('the database refuses a foreign account, a foreign profile, no subject, two subjects and an identity edit', async () => {
    const event = eventId(await make([{ kind: 'profile', id: KID }]))
    const row = { event_id: event, family_id: A }
    await expect(db.eventParticipant.create({ data: { ...row, user_id: F } })).rejects.toThrow()
    await expect(db.eventParticipant.create({ data: { ...row, member_id: FKID } })).rejects.toThrow()
    await expect(db.eventParticipant.create({ data: row })).rejects.toThrow()
    await expect(db.eventParticipant.create({ data: { ...row, user_id: P, member_id: ARCHIVED } })).rejects.toThrow()
    await expect(db.eventParticipant.updateMany({ where: { event_id: event }, data: { member_id: ARCHIVED } })).rejects.toThrow()
    expect(await stored(event)).toEqual([KID])
  })

  it('PATCH replaces absolutely, leaves people when omitted, clears on [], and is parent- and household-scoped', async () => {
    const event = eventId(await make([{ kind: 'account', id: T }, { kind: 'profile', id: KID }]))
    expect(shown(await update(db, actor, { eventId: event, title: 'Moved' }))).toEqual([T, KID])
    expect(shown(await update(db, actor, { eventId: event, participants: [{ kind: 'account', id: P }] }))).toEqual([P])
    expect((await update(db, { ...actor, userId: T }, { eventId: event, participants: [] })).status).toBe(403)
    expect((await update(db, { familyId: B, userId: F, tokenVersion: 0 }, { eventId: event, participants: [] })).status).toBe(404)
    expect(await stored(event)).toEqual([P])
    expect(shown(await update(db, actor, { eventId: event, participants: [] }))).toEqual([])
    expect(await stored(event)).toEqual([])
  })

  it('shows current members only, and cascades with the account and the event', async () => {
    const event = eventId(await make([{ kind: 'account', id: T }, { kind: 'profile', id: KID }]))
    const read = async () => (await people.projectEventParticipants(db, A, [{ id: event }]))[0].participants.map((p) => p.id)
    expect(await read()).toEqual([T, KID])
    await db.user.update({ where: { id: T }, data: { family_id: null } })
    await db.householdMember.update({ where: { id: KID }, data: { archived_at: new Date() } })
    expect(await read()).toEqual([])
    await db.user.update({ where: { id: T }, data: { family_id: A } })
    await db.householdMember.update({ where: { id: KID }, data: { archived_at: null } })
    expect(await read()).toEqual([T, KID])
    await db.event.delete({ where: { id: event } })
    expect(await db.eventParticipant.count({ where: { family_id: A } })).toBe(0)
  })
})
