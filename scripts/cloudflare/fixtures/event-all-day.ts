import { mutateD1Event } from '../../../src/lib/cloudflare/event-mutations'
import { updateD1PersonEvent } from '../../../src/lib/cloudflare/event-update'
import { readD1CalendarEvents } from '../../../src/lib/cloudflare/calendar-events'
import { syncD1CalendarSubscription } from '../../../src/lib/cloudflare/calendar-sync'
import { buildD1CalendarFeed } from '../../../src/lib/cloudflare/calendar-feed'
import { readD1TodayBoard } from '../../../src/lib/cloudflare/today-board'
import { readD1ScheduleSnapshot } from '../../../src/lib/cloudflare/schedule-source'
import { topUpD1EventSeries } from '../../../src/lib/cloudflare/event-series'
import { EVENT_REPEAT_READY_ENV, localDayIn, wallTimeIn } from '../../../src/lib/event-series'
import { allDayDays } from '../../../src/lib/all-day'
import { CALENDAR_OWNER_PROTOCOL, type CalendarReadOwner } from '../../../src/lib/calendar-read-owner'
import { encryptSecret } from '../../../src/lib/secret-box'
import { checkProviderUrlShape } from '../../../src/lib/outbound-url'
import type { D1Store } from '../../../src/lib/cloudflare/database'
function check(value: unknown, label: string): asserts value { if (!value) throw new Error(label) }
const TZ = 'America/Toronto'

/** All-day events on real workerd/D1: write, read, repeat, import, feed and board. */
export async function testEventAllDay(db: D1Store) {
  process.env.JWT_SECRET = 'fabricated-all-day-key-not-a-real-secret'
  process.env.HEREWOVEN_STORAGE = 'd1'
  await db.prepare(`INSERT INTO "Family" (id,name,invite_code,feed_token) VALUES ('allday-a','Fixture','allday-a','allday-feed-token'),('allday-b','Other','allday-b',NULL)`).run()
  await db.prepare(`INSERT INTO "User" (id,email,name,family_id,role,created_at) VALUES
    ('allday-parent','allday-parent@example.test','Parent','allday-a','parent',1),
    ('allday-foreign','allday-foreign@example.test','Foreign','allday-b','parent',2)`).run()
  const actor = { userId: 'allday-parent', familyId: 'allday-a', role: 'parent', generation: 0, name: 'Parent' }
  const editor = { userId: 'allday-parent', familyId: 'allday-a', tokenVersion: 0 }
  const owner: CalendarReadOwner = { protocol: CALENDAR_OWNER_PROTOCOL, actorId: 'allday-parent', familyId: 'allday-a', role: 'parent', generation: 0 }
  const now = new Date('2026-03-02T15:00:00Z')
  type Row = { id: string; title: string; start_time: number; end_time: number; all_day: number; series_id: string | null }
  const rows = async (where = `family_id='allday-a'`) => (await db.prepare(`SELECT id,title,start_time,end_time,all_day,series_id FROM "Event" WHERE ${where} ORDER BY start_time,id`).all<Row>()).results

  // A writer that does not know the column (older code) still makes a timed event.
  await db.prepare(`INSERT INTO "Event" (id,family_id,title,start_time,end_time,created_by) VALUES ('allday-legacy','allday-a','Legacy',?1,?2,'allday-parent')`)
    .bind(Date.parse('2026-03-02T18:00:00Z'), Date.parse('2026-03-02T19:00:00Z')).run()
  check((await rows(`id='allday-legacy'`))[0].all_day === 0, 'the column defaults to a timed event')
  let refusedValue = false
  try { await db.prepare(`UPDATE "Event" SET all_day=2 WHERE id='allday-legacy'`).run() } catch { refusedValue = true }
  check(refusedValue, 'the column only holds 0 or 1')

  // Create: a request without the field is timed; with it, the flag is stored and returned.
  const timed = await mutateD1Event(actor, { kind: 'create', input: { title: 'Dentist', start_time: '2026-03-03T15:00:00Z', end_time: '2026-03-03T16:00:00Z', event_type: 'other' } }, null, { database: db, now })
  check(timed.status === 200 && (timed.body as { event: { all_day: boolean } }).event.all_day === false, 'omitted means timed')
  // 2026-03-03 in Toronto: 00:00 to 23:59 local.
  const start = '2026-03-03T05:00:00.000Z', end = '2026-03-04T04:59:00.000Z'
  const made = await mutateD1Event(actor, { kind: 'create', input: { title: 'Field trip', start_time: start, end_time: end, event_type: 'school', all_day: true } }, 'allday-key', { database: db, now })
  const madeEvent = (made.body as { event: { id: string; all_day: boolean } }).event
  check(made.status === 200 && madeEvent.all_day === true && (await rows(`id='${madeEvent.id}'`))[0].all_day === 1, 'all day is stored and returned')
  const replay = await mutateD1Event(actor, { kind: 'create', input: { title: 'Field trip', start_time: start, end_time: end, event_type: 'school', all_day: true } }, 'allday-key', { database: db, now })
  check(replay.replayed && JSON.stringify(replay.body) === JSON.stringify(made.body), 'a retry returns the same all-day event')

  // Read: one event and a range both carry the flag as a boolean.
  const [one] = await readD1CalendarEvents(owner, { id: madeEvent.id }, db)
  check(one.all_day === true && (await readD1CalendarEvents(owner, { id: 'allday-legacy' }, db))[0].all_day === false, 'single read returns a boolean')
  const range = await readD1CalendarEvents(owner, { range: { start: new Date('2026-03-03T05:00:00Z'), end: new Date('2026-03-04T05:00:00Z'), limit: 50, after: null } as never }, db)
  check(range.filter((e) => e.all_day).map((e) => e.id).join() === madeEvent.id, 'range read marks only the all-day event')

  // Update: off and on again; an edit that omits the field leaves it alone.
  const renamed = await updateD1PersonEvent(editor, { eventId: madeEvent.id, title: 'Museum trip' }, db)
  check(renamed.status === 200 && (renamed.body as { event: { all_day: boolean } }).event.all_day === true, 'an edit without the field keeps all day')
  const off = await updateD1PersonEvent(editor, { eventId: madeEvent.id, all_day: false, start_time: '2026-03-03T14:00:00Z', end_time: '2026-03-03T15:00:00Z' }, db)
  check(off.status === 200 && (off.body as { event: { all_day: boolean } }).event.all_day === false && (await rows(`id='${madeEvent.id}'`))[0].all_day === 0, 'all day can be turned off')
  const on = await updateD1PersonEvent(editor, { eventId: madeEvent.id, all_day: true, start_time: start, end_time: '2026-03-05T04:59:00.000Z' }, db)
  const days = allDayDays((await rows(`id='${madeEvent.id}'`))[0].start_time, (await rows(`id='${madeEvent.id}'`))[0].end_time)
  check(on.status === 200 && (on.body as { event: { all_day: boolean } }).event.all_day === true && days?.first === '2026-03-03' && days.last === '2026-03-04', 'all day can be turned on for two days')
  check((await updateD1PersonEvent({ userId: 'allday-foreign', familyId: 'allday-b', tokenVersion: 0 }, { eventId: madeEvent.id, all_day: false, start_time: start, end_time: end }, db)).status === 404
    && (await rows(`id='${madeEvent.id}'`))[0].all_day === 1, 'another household cannot change it')

  // Repeating all day: every occurrence is 00:00 to 23:59 local, across the March clock change.
  process.env[EVENT_REPEAT_READY_ENV] = '1'
  const series = await mutateD1Event(actor, { kind: 'create', input: { title: 'Recycling week', start_time: '2026-03-06T05:00:00.000Z', end_time: '2026-03-07T04:59:00.000Z',
    event_type: 'other', all_day: true, repeat: { every: 'day', time_zone: TZ, until: '2026-03-10' } } }, null, { database: db, now })
  const seriesId = (series.body as { event: { series_id: string; all_day: boolean } }).event.series_id
  const repeats = await rows(`series_id='${seriesId}'`)
  check(series.status === 200 && repeats.length === 5 && repeats.every((r) => r.all_day === 1), 'every repeat is all day')
  check(repeats.every((r) => { const a = wallTimeIn(r.start_time, TZ), b = wallTimeIn(r.end_time, TZ); return a.hour === 0 && a.minute === 0 && b.hour === 23 && b.minute === 59 && localDayIn(r.start_time, TZ) === localDayIn(r.end_time, TZ) }),
    'each repeat stays inside its own local day')
  check(repeats.some((r) => r.end_time - r.start_time === 23 * 3_600_000 - 60_000), 'the 23-hour day is one hour shorter, not a day longer')
  check((await db.prepare(`SELECT all_day FROM "EventSeries" WHERE id=?1`).bind(seriesId).first<{ all_day: number }>())!.all_day === 1, 'the series template carries all day')
  // "This and later" keeps it all day when the request does not say otherwise.
  const following = await updateD1PersonEvent(editor, { eventId: repeats[2].id, series_scope: 'following', title: 'Compost week' }, db)
  const later = (await rows()).filter((r) => r.title === 'Compost week')
  check(following.status === 200 && later.length === 3 && later.every((r) => r.all_day === 1 && wallTimeIn(r.end_time, TZ).hour === 23), 'this and later stays all day')
  await topUpD1EventSeries(db.withSession('first-primary'), 'allday-a', new Date('2026-03-09T12:00:00Z'))
  check((await rows()).filter((r) => r.series_id !== null).every((r) => r.all_day === 1), 'a top-up on read writes all-day rows')
  delete process.env[EVENT_REPEAT_READY_ENV]

  // Subscribed feed: a DATE-valued DTSTART is all day; a timed one is not; a change of kind updates the row.
  await db.prepare(`INSERT INTO "CalendarSubscription" (id,family_id,created_by,name,url_enc) VALUES ('allday-sub','allday-a','allday-parent','School',?1)`)
    .bind(encryptSecret('https://calendar.example.test/all-day-fixture')).run()
  const assertUrl = async (url: string) => { if (checkProviderUrlShape(url)) throw new Error('Refused fixture address') }
  const feed = (pd: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:pd-day\r\n${pd}\r\nSUMMARY:PD day\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:concert\r\nDTSTART:20260312T230000Z\r\nDTEND:20260313T000000Z\r\nSUMMARY:Concert\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`
  const sync = (body: string) => syncD1CalendarSubscription('allday-sub', 'allday-a', { actor: { userId: 'allday-parent', familyId: 'allday-a', role: 'parent', generation: 0 }, now, assertUrl,
    fetchImpl: async () => new Response(body, { headers: { 'content-type': 'text/calendar' } }) } as never, db)
  const imported = await sync(feed('DTSTART;VALUE=DATE:20260313\r\nDTEND;VALUE=DATE:20260315'))
  const pd = (await rows(`source_uid='pd-day'`))[0], concert = (await rows(`source_uid='concert'`))[0]
  const pdDays = allDayDays(pd.start_time, pd.end_time)
  check(imported?.created === 2 && pd.all_day === 1 && concert.all_day === 0, 'DATE values import as all day')
  check(pdDays?.first === '2026-03-13' && pdDays.last === '2026-03-14', 'the exclusive DTEND is the day after the last day')
  check((await sync(feed('DTSTART;VALUE=DATE:20260313\r\nDTEND;VALUE=DATE:20260315')))?.updated === 0, 'an unchanged feed changes nothing')
  // Same first instant, now with a time of day: only the kind changed.
  const retimed = await sync(feed('DTSTART:20260313T040000Z\r\nDTEND:20260315T040000Z'))
  check(retimed?.updated === 1 && (await rows(`source_uid='pd-day'`))[0].all_day === 0, 'a feed that adds a time turns all day off')
  await sync(feed('DTSTART;VALUE=DATE:20260313\r\nDTEND;VALUE=DATE:20260315'))

  // Our own feed: DATE values for all-day events, instants for the rest, another household never.
  const out = await buildD1CalendarFeed('allday-feed-token', now, db)
  check(out.kind === 'ok', 'feed builds')
  const ics = out.kind === 'ok' ? out.ics : ''
  const block = (title: string) => ics.split('BEGIN:VEVENT').find((part) => part.includes(`SUMMARY:${title}`)) ?? ''
  check(block('Museum trip').includes('DTSTART;VALUE=DATE:20260303\r\n') && block('Museum trip').includes('DTEND;VALUE=DATE:20260305\r\n'), 'a two-day all-day event exports as DATE values with an exclusive end')
  check(block('PD day').includes('DTSTART;VALUE=DATE:20260313\r\n') && block('PD day').includes('DTEND;VALUE=DATE:20260315\r\n'), 'an imported all-day event round-trips')
  check(block('Dentist').includes('DTSTART:20260303T150000Z\r\n') && !block('Dentist').includes('VALUE=DATE'), 'a timed event keeps its instants')

  // "At the same time": an all-day event is never read as busy time, unless it is the one under review.
  const dentistId = (timed.body as { event: { id: string } }).event.id
  const reviewRange = { start: '2026-03-03T05:00:00Z', end: '2026-03-04T05:00:00Z' }
  const reviewActor = { userId: 'allday-parent', familyId: 'allday-a', role: 'parent' as const, tokenVersion: 0 }
  const forDentist = await readD1ScheduleSnapshot(reviewActor, { targetId: dentistId, range: reviewRange, timeZone: TZ }, db, now)
  const forTrip = await readD1ScheduleSnapshot(reviewActor, { targetId: madeEvent.id, range: reviewRange, timeZone: TZ }, db, now)
  check(forDentist.snapshot.events.map((e) => e.id).join() === dentistId, 'the same-time read leaves all-day events out')
  check(forTrip.snapshot.events.map((e) => e.id).sort().join() === [dentistId, madeEvent.id].sort().join(), 'the event under review is still read')

  // Today board: the flag reaches the board only for all-day events.
  const board = await readD1TodayBoard({ familyId: 'allday-a', role: 'parent', audience: 'person', memberProtocol: 1, now: new Date('2026-03-03T15:00:00Z'), withWeather: false }, db)
  const trip = board.data.events.find((e) => e.title === 'Museum trip'), dentist = board.data.events.find((e) => e.title === 'Dentist')
  check(trip?.allDay === true && dentist !== undefined && !('allDay' in dentist), 'the board marks only all-day events')
  const foreign = await readD1TodayBoard({ familyId: 'allday-b', role: 'parent', audience: 'person', memberProtocol: 1, now: new Date('2026-03-03T15:00:00Z'), withWeather: false }, db)
  check(foreign.data.events.length === 0, 'another household sees none of it')
  await db.prepare(`DELETE FROM "Family" WHERE id IN ('allday-a','allday-b')`).run()
  return { defaultTimed: true, createAndReplay: true, readBoolean: true, updateToggle: true, repeatAcrossDst: true, followingKeepsAllDay: true,
    icsImport: true, icsExport: true, sameTimeExcluded: true, todayBoard: true, householdIsolation: true }
}
