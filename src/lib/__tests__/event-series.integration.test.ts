// Repeating events against disposable Postgres: create, top-up on read, this/following edits and deletes.
import { assertFixtureTargetAllowed } from '@/lib/fixtures/guard'
import { EVENT_REPEAT_READY_ENV, SERIES_HORIZON_MS, seriesEventId } from '@/lib/event-series'
import { EVENT_PEOPLE_READY_ENV } from '@/lib/event-participants'
export {}
const dbSuite = process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip
jest.setTimeout(60000)
dbSuite('repeating events (Postgres)', () => {
  let db: NonNullable<typeof import('@/lib/prisma').prisma>
  let create: typeof import('@/lib/person-event-create').createPersonEvent
  let update: typeof import('@/lib/person-event-update').updatePersonEvent
  let series: typeof import('@/lib/event-series-db')
  const A = 'series-pg-family-a', B = 'series-pg-family-b'
  const P = 'series-pg-parent', T = 'series-pg-teen', F = 'series-pg-foreign'
  const TZ = 'America/Toronto', WEEK = 7 * 86_400_000
  const actor = { familyId: A, userId: P, name: 'Parent', tokenVersion: 0 }
  const first = Date.parse('2026-01-05T14:00:00.000Z') // 9:00 Toronto, a Monday
  const base = { title: 'Swim', start_time: '2026-01-05T14:00:00.000Z', end_time: '2026-01-05T15:00:00.000Z', event_type: 'sports' as const }
  type Repeat = { every: 'day' | 'week' | '2weeks' | 'month' | 'year'; until?: string | null; time_zone: string }
  const make = (repeat?: Repeat, extra: Record<string, unknown> = {}) => create(db, { ...base, ...extra, repeat }, actor, null)
  const rows = () => db.event.findMany({ where: { family_id: A }, orderBy: [{ start_time: 'asc' }, { id: 'asc' }] })
  const seriesRows = () => db.eventSeries.findMany({ where: { family_id: A }, orderBy: [{ anchor_start: 'asc' }, { id: 'asc' }] })
  const clean = async () => {
    await db.family.deleteMany({ where: { id: { in: [A, B] } } })
    await db.user.deleteMany({ where: { id: { in: [P, T, F] } } })
  }
  beforeAll(async () => {
    assertFixtureTargetAllowed(process.env)
    db = (await import('@/lib/prisma')).prisma!
    create = (await import('@/lib/person-event-create')).createPersonEvent
    update = (await import('@/lib/person-event-update')).updatePersonEvent
    series = await import('@/lib/event-series-db')
    await clean()
    await db.family.createMany({ data: [{ id: A, name: 'Series A', invite_code: A }, { id: B, name: 'Series B', invite_code: B }] })
    await db.user.createMany({ data: [
      { id: P, email: 'series-pg-parent@example.test', name: 'Parent', role: 'parent', family_id: A },
      { id: T, email: 'series-pg-teen@example.test', name: 'Teen', role: 'teen', family_id: A },
      { id: F, email: 'series-pg-foreign@example.test', name: 'Foreign', role: 'parent', family_id: B },
    ] })
  })
  beforeEach(async () => {
    process.env[EVENT_REPEAT_READY_ENV] = '1'
    process.env[EVENT_PEOPLE_READY_ENV] = '1'
    await db.event.deleteMany({ where: { family_id: { in: [A, B] } } })
    await db.eventSeries.deleteMany({ where: { family_id: { in: [A, B] } } })
  })
  afterAll(async () => {
    delete process.env[EVENT_REPEAT_READY_ENV]; delete process.env[EVENT_PEOPLE_READY_ENV]
    if (!db) return
    await clean()
    await db.$disconnect()
  })

  it('capability off: refuses a repeat before any write and tops nothing up', async () => {
    process.env[EVENT_REPEAT_READY_ENV] = '0'
    expect(await make({ every: 'week', time_zone: TZ })).toMatchObject({ status: 409, body: { code: 'EVENT_REPEAT_UNSUPPORTED' } })
    expect(await rows()).toHaveLength(0)
    expect(await series.topUpEventSeries(db, A, new Date())).toBe(0)
  })

  it.each([
    ['an unknown zone', { every: 'week' as const, time_zone: 'Mars/Olympus' }],
    ['a last day before the start', { every: 'week' as const, time_zone: TZ, until: '2026-01-04' }],
  ])('refuses %s and writes nothing', async (_label, repeat) => {
    expect(await make(repeat)).toMatchObject({ status: 400, body: { code: 'EVENT_REPEAT_INVALID' } })
    expect(await rows()).toHaveLength(0)
    expect(await seriesRows()).toHaveLength(0)
  })

  it('writes one series and its occurrences with the same local time and people; the response is the first one', async () => {
    const made = await make({ every: 'week', time_zone: TZ, until: '2026-04-06' }, { participants: [{ kind: 'account', id: T }] })
    const [one] = await seriesRows()
    const all = await rows()
    expect(made).toMatchObject({ status: 200, body: { event: { id: seriesEventId(one.id, first), series_id: one.id } } })
    expect(all).toHaveLength(14)
    expect(all.every((r) => r.series_id === one.id && r.end_time.getTime() - r.start_time.getTime() === 3_600_000 && r.id === seriesEventId(one.id, r.start_time.getTime()))).toBe(true)
    // Spring forward (Mar 8): the UTC gap is an hour shorter, the local time is still 9:00.
    const gaps = all.slice(1).map((r, i) => r.start_time.getTime() - all[i].start_time.getTime())
    expect(new Set(gaps)).toEqual(new Set([WEEK, WEEK - 3_600_000]))
    expect(await db.eventParticipant.count({ where: { family_id: A, user_id: T } })).toBe(14)
    expect(await db.activity.count({ where: { family_id: A, type: 'event_created' } })).toBe(1)
  })

  it('tops up on read exactly once per occurrence, and a deleted occurrence stays deleted', async () => {
    await make({ every: 'day', time_zone: TZ })
    const before = await rows()
    const [one] = await seriesRows()
    await db.event.delete({ where: { id: before[2].id } })
    // A reader ten days past what is written: "now" plus the look-ahead lands exactly there.
    const later = new Date(one.generated_through.getTime() + 10 * 86_400_000 - SERIES_HORIZON_MS)
    const written = await Promise.all([series.topUpEventSeries(db, A, later), series.topUpEventSeries(db, A, later)])
    const after = await rows()
    expect(written.reduce((a, b) => a + b, 0)).toBe(10)
    expect(after.length).toBe(before.length - 1 + 10)
    expect(new Set(after.map((r) => r.id)).size).toBe(after.length)
    expect(after.some((r) => r.id === before[2].id)).toBe(false)
  })

  it('"this event" marks one row; "this and later" ends the old series the day before and rewrites the rest', async () => {
    await make({ every: 'week', time_zone: TZ, until: '2026-03-30' })
    const all = await rows()
    const [original] = await seriesRows()
    expect((await update(db, actor, { eventId: all[5].id, title: 'Swim (bring goggles)' })).status).toBe(200)
    expect((await db.event.findUnique({ where: { id: all[5].id } }))!.series_detached).toBe(true)
    const following = await update(db, actor, { eventId: all[3].id, series_scope: 'following', title: 'Swim team', start_time: '2026-01-26T15:00:00.000Z' })
    expect(following).toMatchObject({ status: 200, body: { event: { id: all[3].id, title: 'Swim team' } } })
    const after = await rows()
    expect(after.slice(0, 3).every((r) => r.title === 'Swim' && r.series_id === original.id)).toBe(true)
    // The individually changed later event is replaced too, so no day has two.
    expect(after.filter((r) => r.title === 'Swim team')).toHaveLength(all.length - 3)
    expect(after).toHaveLength(all.length)
    const split = await seriesRows()
    expect(split).toHaveLength(2)
    expect(split[0]).toMatchObject({ id: original.id, until_day: '2026-01-25' })
    expect(split[1]).toMatchObject({ title: 'Swim team', until_day: '2026-03-30', anchor_start: new Date('2026-01-26T15:00:00.000Z') })
    expect(after.filter((r) => r.series_id === split[1].id).every((r) => r.start_time.getUTCDay() === 1 && r.end_time.getTime() - r.start_time.getTime() === 3_600_000)).toBe(true)
  })

  it('stops repeating from an event on; refuses a one-off, a teen and another household', async () => {
    await make({ every: 'week', time_zone: TZ, until: '2026-03-30' })
    const all = await rows()
    const stop = await update(db, actor, { eventId: all[2].id, series_scope: 'following', repeat: null })
    expect(stop.status).toBe(200)
    const after = await rows()
    expect(after).toHaveLength(3)
    expect(after[2]).toMatchObject({ id: all[2].id, series_id: null, series_occurrence_start: null })
    expect(await update(db, actor, { eventId: all[2].id, series_scope: 'following', title: 'x' })).toMatchObject({ status: 409, body: { code: 'EVENT_SERIES_SCOPE_INVALID' } })
    expect((await update(db, { ...actor, userId: T }, { eventId: all[0].id, series_scope: 'following', title: 'x' })).status).toBe(403)
    expect((await update(db, { familyId: B, userId: F, tokenVersion: 0 }, { eventId: all[0].id, series_scope: 'following', title: 'x' })).status).toBe(404)
    expect((await series.deletePersonEventFollowing(db, { familyId: B, userId: F, tokenVersion: 0 }, all[0].id)).status).toBe(404)
    expect((await rows())[0].title).toBe('Swim')
  })

  it('a one-off event starts repeating from itself; it needs a repeat, and connected or rule-carrying events are refused', async () => {
    const one = await make(undefined, { participants: [{ kind: 'account', id: T }] })
    const id = (one.body as { event: { id: string } }).event.id
    expect(await update(db, actor, { eventId: id, series_scope: 'following', title: 'x' })).toMatchObject({ status: 409, body: { code: 'EVENT_SERIES_SCOPE_INVALID' } })
    expect(await update(db, actor, { eventId: id, series_scope: 'following', repeat: { every: 'week', time_zone: 'Mars/Olympus' } })).toMatchObject({ status: 400, body: { code: 'EVENT_REPEAT_INVALID' } })
    expect((await update(db, { ...actor, userId: T }, { eventId: id, series_scope: 'following', repeat: { every: 'week', time_zone: TZ } })).status).toBe(403)
    expect((await update(db, { familyId: B, userId: F, tokenVersion: 0 }, { eventId: id, series_scope: 'following', repeat: { every: 'week', time_zone: TZ } })).status).toBe(404)
    expect(await seriesRows()).toHaveLength(0)
    const started = await update(db, actor, { eventId: id, series_scope: 'following', title: 'Swim club', repeat: { every: 'week', time_zone: TZ, until: '2026-02-02' } })
    expect(started).toMatchObject({ status: 200, body: { event: { id, title: 'Swim club' } } })
    const [made] = await seriesRows()
    const all = await rows()
    expect(all).toHaveLength(5)
    expect(all[0]).toMatchObject({ id, series_id: made.id, series_occurrence_start: new Date(first) })
    expect(all.every((r) => r.title === 'Swim club' && r.series_id === made.id && r.start_time.getUTCDay() === 1)).toBe(true)
    expect(made).toMatchObject({ created_by: P, anchor_start: new Date(first), until_day: '2026-02-02' })
    // The people on the event carry to every repeat.
    expect(await db.eventParticipant.count({ where: { family_id: A, user_id: T } })).toBe(5)
    // Events that carry a stored rule or come from a connected calendar keep their own handling.
    const legacy = await db.event.create({ data: { family_id: A, title: 'Legacy', created_by: P, start_time: new Date(first), end_time: new Date(first + 1), recurrence: 'FREQ=WEEKLY' } })
    expect(await update(db, actor, { eventId: legacy.id, series_scope: 'following', repeat: { every: 'week', time_zone: TZ } })).toMatchObject({ status: 409, body: { code: 'EVENT_SERIES_SCOPE_INVALID' } })
  })

  it('deletes this and later; from the first occurrence it removes the series; the database refuses a foreign series', async () => {
    await make({ every: 'day', time_zone: TZ, until: '2026-01-14' })
    const all = await rows()
    expect(all).toHaveLength(10)
    expect((await series.deletePersonEventFollowing(db, actor, all[6].id)).status).toBe(200)
    expect(await rows()).toHaveLength(6)
    expect((await seriesRows())[0].until_day).toBe('2026-01-10')
    expect((await series.deletePersonEventFollowing(db, actor, all[0].id)).status).toBe(200)
    expect(await rows()).toHaveLength(0)
    expect(await seriesRows()).toHaveLength(0)
    await make({ every: 'week', time_zone: TZ, until: '2026-01-19' })
    const [mine] = await seriesRows()
    await expect(db.event.create({ data: { family_id: B, title: 'x', start_time: new Date(1), end_time: new Date(2), created_by: F, series_id: mine.id, series_occurrence_start: new Date(1) } })).rejects.toThrow()
  })
})
