// All-day events against disposable Postgres: write, read, repeat, import, feed and the same-time read.
import { assertFixtureTargetAllowed } from '@/lib/fixtures/guard'
import { EVENT_REPEAT_READY_ENV, localDayIn, wallTimeIn } from '@/lib/event-series'
import { allDayDays } from '@/lib/all-day'
export {}
const dbSuite = process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip
jest.setTimeout(60000)
dbSuite('all-day events (Postgres)', () => {
  let db: NonNullable<typeof import('@/lib/prisma').prisma>
  let create: typeof import('@/lib/person-event-create').createPersonEvent
  let update: typeof import('@/lib/person-event-update').updatePersonEvent
  let series: typeof import('@/lib/event-series-db')
  let reconcile: typeof import('@/lib/calendar-import/sync').reconcileOccurrences
  let parse: typeof import('@/lib/calendar-import/parse').parseIcsFeed
  let feed: typeof import('@/lib/calendar-feed').buildCalendarFeed
  let schedule: typeof import('@/lib/calendar-planning/schedule-source')
  const A = 'allday-pg-family-a', B = 'allday-pg-family-b'
  const P = 'allday-pg-parent', F = 'allday-pg-foreign', SUB = 'allday-pg-sub'
  const TZ = 'America/Toronto'
  const actor = { familyId: A, userId: P, name: 'Parent', tokenVersion: 0 }
  const editor = { familyId: A, userId: P, tokenVersion: 0 }
  // 2026-03-03 in Toronto: 00:00 to 23:59 local.
  const day = { title: 'Field trip', start_time: '2026-03-03T05:00:00.000Z', end_time: '2026-03-04T04:59:00.000Z', event_type: 'school' as const }
  const rows = (where: Record<string, unknown> = {}) => db.event.findMany({ where: { family_id: A, ...where }, orderBy: [{ start_time: 'asc' }, { id: 'asc' }] })
  const clean = async () => {
    await db.family.deleteMany({ where: { id: { in: [A, B] } } })
    await db.user.deleteMany({ where: { id: { in: [P, F] } } })
  }
  beforeAll(async () => {
    assertFixtureTargetAllowed(process.env)
    db = (await import('@/lib/prisma')).prisma!
    create = (await import('@/lib/person-event-create')).createPersonEvent
    update = (await import('@/lib/person-event-update')).updatePersonEvent
    series = await import('@/lib/event-series-db')
    reconcile = (await import('@/lib/calendar-import/sync')).reconcileOccurrences
    parse = (await import('@/lib/calendar-import/parse')).parseIcsFeed
    feed = (await import('@/lib/calendar-feed')).buildCalendarFeed
    schedule = await import('@/lib/calendar-planning/schedule-source')
    await clean()
    await db.family.createMany({ data: [{ id: A, name: 'All day A', invite_code: A, feed_token: 'allday-pg-feed-token' }, { id: B, name: 'All day B', invite_code: B }] })
    await db.user.createMany({ data: [
      { id: P, email: 'allday-pg-parent@example.test', name: 'Parent', role: 'parent', family_id: A },
      { id: F, email: 'allday-pg-foreign@example.test', name: 'Foreign', role: 'parent', family_id: B },
    ] })
  })
  beforeEach(async () => {
    process.env[EVENT_REPEAT_READY_ENV] = '1'
    await db.event.deleteMany({ where: { family_id: { in: [A, B] } } })
    await db.eventSeries.deleteMany({ where: { family_id: { in: [A, B] } } })
    await db.calendarSubscription.deleteMany({ where: { family_id: { in: [A, B] } } })
  })
  afterAll(async () => {
    delete process.env[EVENT_REPEAT_READY_ENV]
    if (!db) return
    await clean()
    await db.$disconnect()
  })

  it('a writer that does not name the column makes a timed event', async () => {
    await db.$executeRaw`INSERT INTO "Event" ("id","family_id","title","start_time","end_time","created_by")
      VALUES ('allday-pg-legacy', ${A}, 'Legacy', now(), now(), ${P})`
    expect((await rows({ id: 'allday-pg-legacy' }))[0].all_day).toBe(false)
  })

  it('create stores and returns all_day; omitted means timed', async () => {
    const made = await create(db, { ...day, all_day: true }, actor, null)
    expect(made).toMatchObject({ status: 200, body: { event: { title: 'Field trip', all_day: true } } })
    const timed = await create(db, { title: 'Dentist', start_time: '2026-03-03T15:00:00.000Z', end_time: '2026-03-03T16:00:00.000Z', event_type: 'other' }, actor, null)
    expect(timed).toMatchObject({ status: 200, body: { event: { all_day: false } } })
    expect((await rows()).map((row) => [row.title, row.all_day])).toEqual([['Field trip', true], ['Dentist', false]])
  })

  it('update turns it off and on; an edit that omits it leaves it alone; another household cannot', async () => {
    const made = await create(db, { ...day, all_day: true }, actor, null)
    const id = (made.body as { event: { id: string } }).event.id
    expect(await update(db, editor, { eventId: id, title: 'Museum trip' })).toMatchObject({ status: 200, body: { event: { title: 'Museum trip', all_day: true } } })
    expect(await update(db, editor, { eventId: id, all_day: false, start_time: '2026-03-03T14:00:00.000Z', end_time: '2026-03-03T15:00:00.000Z' }))
      .toMatchObject({ status: 200, body: { event: { all_day: false } } })
    expect(await update(db, editor, { eventId: id, all_day: true, start_time: day.start_time, end_time: '2026-03-05T04:59:00.000Z' }))
      .toMatchObject({ status: 200, body: { event: { all_day: true } } })
    const [row] = await rows({ id })
    expect(allDayDays(row.start_time, row.end_time)).toEqual({ first: '2026-03-03', last: '2026-03-04' })
    expect((await update(db, { familyId: B, userId: F, tokenVersion: 0 }, { eventId: id, all_day: false })).status).toBe(404)
    expect((await rows({ id }))[0].all_day).toBe(true)
  })

  it('a repeating all-day event stays inside its own local day across the March clock change', async () => {
    const made = await create(db, { title: 'Recycling week', start_time: '2026-03-06T05:00:00.000Z', end_time: '2026-03-07T04:59:00.000Z', event_type: 'other',
      all_day: true, repeat: { every: 'day', time_zone: TZ, until: '2026-03-10' } }, actor, null)
    expect(made.status).toBe(200)
    const repeats = await rows()
    expect(repeats).toHaveLength(5)
    expect((await db.eventSeries.findMany({ where: { family_id: A } }))[0].all_day).toBe(true)
    for (const row of repeats) {
      const start = wallTimeIn(row.start_time.getTime(), TZ), end = wallTimeIn(row.end_time.getTime(), TZ)
      expect([row.all_day, start.hour, start.minute, end.hour, end.minute]).toEqual([true, 0, 0, 23, 59])
      expect(localDayIn(row.end_time.getTime(), TZ)).toBe(localDayIn(row.start_time.getTime(), TZ))
    }
    // March 8 is 23 hours long: the event is an hour shorter, not a day longer.
    expect(repeats.map((row) => row.end_time.getTime() - row.start_time.getTime())).toContain(23 * 3_600_000 - 60_000)

    // "This and later" keeps it all day; a later top-up writes all-day rows too.
    const following = await update(db, editor, { eventId: repeats[2].id, series_scope: 'following', title: 'Compost week' })
    expect(following).toMatchObject({ status: 200, body: { event: { all_day: true } } })
    const later = (await rows()).filter((row) => row.title === 'Compost week')
    expect(later).toHaveLength(3)
    expect(later.every((row) => row.all_day && wallTimeIn(row.end_time.getTime(), TZ).hour === 23)).toBe(true)
    await series.topUpEventSeries(db, A, new Date('2026-03-09T12:00:00Z'))
    expect((await rows()).every((row) => row.all_day)).toBe(true)
  })

  it('a subscribed feed imports DATE values as all day, and our feed exports them as DATE values', async () => {
    await db.calendarSubscription.create({ data: { id: SUB, family_id: A, created_by: P, name: 'School', url_enc: 'fixture' } })
    const window = { start: new Date('2026-02-01T00:00:00Z'), end: new Date('2026-05-01T00:00:00Z') }
    const ics = (pd: string) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:pd-day', ...pd.split('\n'), 'SUMMARY:PD day', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:concert', 'DTSTART:20260312T230000Z', 'DTEND:20260313T000000Z', 'SUMMARY:Concert', 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n')
    const run = (pd: string) => reconcile(db, { id: SUB, family_id: A, created_by: P },
      parse(ics(pd), { windowStart: window.start, windowEnd: window.end, defaultTimeZone: TZ }).occurrences, window)
    expect(await run('DTSTART;VALUE=DATE:20260313\nDTEND;VALUE=DATE:20260315')).toEqual({ created: 2, updated: 0, deleted: 0 })
    const [pd] = await rows({ source_uid: 'pd-day' }), [concert] = await rows({ source_uid: 'concert' })
    expect([pd.all_day, concert.all_day]).toEqual([true, false])
    expect(allDayDays(pd.start_time, pd.end_time)).toEqual({ first: '2026-03-13', last: '2026-03-14' })
    expect(await run('DTSTART;VALUE=DATE:20260313\nDTEND;VALUE=DATE:20260315')).toEqual({ created: 0, updated: 0, deleted: 0 })
    // Same instants, now with a time of day: only the kind changed.
    expect(await run('DTSTART:20260313T040000Z\nDTEND:20260315T040000Z')).toEqual({ created: 0, updated: 1, deleted: 0 })
    expect((await rows({ source_uid: 'pd-day' }))[0].all_day).toBe(false)
    await run('DTSTART;VALUE=DATE:20260313\nDTEND;VALUE=DATE:20260315')

    await create(db, { ...day, end_time: '2026-03-05T04:59:00.000Z', all_day: true }, actor, null)
    const out = await db.$transaction((tx) => feed(tx, 'allday-pg-feed-token', new Date('2026-03-02T15:00:00Z')))
    expect(out.kind).toBe('ok')
    const text = out.kind === 'ok' ? out.ics : ''
    const block = (title: string) => text.split('BEGIN:VEVENT').find((part) => part.includes(`SUMMARY:${title}`))!
    expect(block('Field trip')).toContain('DTSTART;VALUE=DATE:20260303\r\n')
    expect(block('Field trip')).toContain('DTEND;VALUE=DATE:20260305\r\n')
    expect(block('PD day')).toContain('DTSTART;VALUE=DATE:20260313\r\n')
    expect(block('PD day')).toContain('DTEND;VALUE=DATE:20260315\r\n')
    expect(block('Concert')).toContain('DTSTART:20260312T230000Z\r\n')
    expect(block('Concert')).not.toContain('VALUE=DATE')
  })

  it('the same-time read leaves all-day events out, except the event being reviewed', async () => {
    const trip = await create(db, { ...day, all_day: true }, actor, null)
    const tripId = (trip.body as { event: { id: string } }).event.id
    const swim = await create(db, { title: 'Swim', start_time: '2026-03-03T21:00:00.000Z', end_time: '2026-03-03T22:00:00.000Z', event_type: 'sports' }, actor, null)
    const swimId = (swim.body as { event: { id: string } }).event.id
    const range = { start: '2026-03-03T05:00:00.000Z', end: '2026-03-04T05:00:00.000Z' }
    const { intervals, forSwim, forTrip } = await db.$transaction(async (tx) => ({
      intervals: await schedule.readScheduleIntervalsInTx(tx, A, range),
      forSwim: await schedule.readScheduleComparisonInTx(tx, A, swimId, range),
      forTrip: await schedule.readScheduleComparisonInTx(tx, A, tripId, range),
    }))
    expect(intervals.map((row) => row.id)).toEqual([swimId])
    expect(forSwim.map((row) => row.id)).toEqual([swimId])
    expect(forTrip.map((row) => row.id).sort()).toEqual([swimId, tripId].sort())
  })
})
