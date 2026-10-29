import { readD1CalendarEvents, readD1CalendarViewer, readD1EventNotificationFocus } from '../../../src/lib/cloudflare/calendar-events'
import { CALENDAR_OWNER_PROTOCOL, type CalendarReadOwner } from '../../../src/lib/calendar-read-owner'
import { encodeCalendarCursor, parseCalendarRange } from '../../../src/lib/calendar-planning/range'
import type { D1Store } from '../../../src/lib/cloudflare/database'
function check(value: unknown, label: string): asserts value { if (!value) throw new Error(label) }
export async function testCalendarEvents(db: D1Store) {
  await db.prepare(`INSERT INTO "Family" (id,name,invite_code) VALUES ('event-read-a','Fixture','event-read-a'),('event-read-b','Other','event-read-b')`).run()
  await db.prepare(`INSERT INTO "User" (id,email,name,family_id,role) VALUES
    ('event-read-parent','event-read-parent@example.test','Own creator','event-read-a','parent'),
    ('event-read-teen','event-read-teen@example.test','Teen','event-read-a','teen'),
    ('event-read-foreign','event-read-foreign@example.test','PRIVATE FOREIGN NAME','event-read-b','parent')`).run()
  await db.prepare(`INSERT INTO "CalendarSubscription" (id,name,family_id,created_by,url_enc,color) VALUES
    ('event-read-source','Own calendar','event-read-a','event-read-parent','opaque-private-fixture','#123abc'),
    ('event-read-foreign-source','PRIVATE FOREIGN SOURCE','event-read-b','event-read-foreign','opaque-foreign-fixture','#ff00ff')`).run()
  const owner: CalendarReadOwner = { protocol: CALENDAR_OWNER_PROTOCOL, actorId: 'event-read-parent', familyId: 'event-read-a', role: 'parent', generation: 0 }
  const now = new Date('2026-10-28T12:00:00Z')
  const start = new Date('2026-10-28T00:00:00Z'), end = new Date('2026-10-29T00:00:00Z')
  const seed = [
    { id: 'event-overlap', start: start.getTime() - 86400000, end: now.getTime() },
    { id: 'event-boundary', start: start.getTime() - 86400000, end: start.getTime() },
    { id: 'event-a', start: now.getTime(), end: now.getTime() + 3600000, source: 'event-read-source' },
    { id: 'event-b', start: now.getTime(), end: now.getTime() + 3600000, task: 1 },
    { id: 'event-c', start: now.getTime() + 3600000, end: now.getTime() + 7200000, creator: 'event-read-foreign', source: 'event-read-foreign-source' },
    { id: 'event-invalid', start: now.getTime() + 7200000, end: now.getTime() + 7200000 },
    { id: 'event-next', start: end.getTime(), end: end.getTime() + 3600000 },
    { id: 'event-history', start: 1, end: 2 },
    { id: 'event-invalid-date', start: 9000000000000000, end: 9000000000000001 },
    { id: 'event-recurring', start: 1, end: 2, recurrence: 'FREQ=WEEKLY' },
  ]
  await db.prepare(`INSERT INTO "Event" (id,family_id,title,start_time,end_time,created_by,source_subscription_id,is_task,recurrence)
    SELECT json_extract(value,'$.id'),'event-read-a',json_extract(value,'$.id'),json_extract(value,'$.start'),json_extract(value,'$.end'),
      COALESCE(json_extract(value,'$.creator'),'event-read-parent'),json_extract(value,'$.source'),COALESCE(json_extract(value,'$.task'),0),json_extract(value,'$.recurrence') FROM json_each(?1)`)
    .bind(JSON.stringify(seed)).run()
  await db.prepare(`INSERT INTO "Event" (id,family_id,title,start_time,end_time,created_by) VALUES ('event-foreign','event-read-b','PRIVATE FOREIGN EVENT',?1,?2,'event-read-foreign')`)
    .bind(now.getTime(), now.getTime() + 3600000).run()
  const range = { start, end, limit: 2, after: null }
  const first = await readD1CalendarEvents(owner, { range }, db)
  check(first.length === 3 && first.map(e => e.id).join() === 'event-overlap,event-a,event-b', 'range overlap and one lookahead')
  const cursor = encodeCalendarCursor(owner.familyId, range, first[1])
  const nextRange = parseCalendarRange(new URLSearchParams({ start: start.toISOString(), end: end.toISOString(), limit: '2', cursor }), owner.familyId)!
  const second = await readD1CalendarEvents(owner, { range: nextRange }, db)
  check(second.map(e => e.id).join() === 'event-b,event-c,event-invalid', 'equal-time cursor stable ordering')
  check(second[0].is_task === true && first[1].start_time.toISOString() === now.toISOString(), 'boolean and millisecond date projection')
  check(first[1].creator?.name === 'Own creator' && first[1].source?.name === 'Own calendar' && first[1].source.color === '#123abc', 'scoped creator and source')
  check(second[1].creator === null && second[1].source?.name === 'Subscribed calendar' && second[1].source.color === null, 'foreign historical references have no current private names')
  const serialized = JSON.stringify([...first, ...second])
  check(!serialized.includes('PRIVATE FOREIGN') && !serialized.includes('opaque-') && !serialized.includes('creator_name'), 'no private source/account helper columns')
  check((await readD1CalendarEvents(owner, { id: 'event-foreign' }, db)).length === 0, 'foreign single concealed')
  check((await readD1CalendarEvents(owner, { id: 'event-history' }, db))[0].id === 'event-history', 'single target independent of list window')
  const recent = await readD1CalendarEvents(owner, { now }, db)
  check(!recent.some(e => e.id === 'event-history') && recent.some(e => e.id === 'event-recurring'), 'recent window retains recurring master')
  const upcoming = await readD1CalendarEvents(owner, { now, upcoming: true }, db)
  check(!upcoming.some(e => ['event-overlap','event-recurring','event-boundary'].includes(e.id)), 'upcoming uses starts from now')
  check((await readD1EventNotificationFocus(owner, 'event-a', db))?.start === now.toISOString(), 'concrete notification target')
  for (const target of ['event-recurring', 'event-invalid', 'event-invalid-date', 'event-foreign', ['event-a'], 'bad/target']) check(await readD1EventNotificationFocus(owner, target, db) === null, 'ambiguous invalid and foreign focus neutral')
  const teen = { ...owner, actorId: 'event-read-teen', role: 'teen' }
  check((await readD1CalendarEvents(teen, { range }, db)).length === 3 && await readD1EventNotificationFocus(teen, 'event-a', db), 'teen own calendar reads')
  await db.prepare(`UPDATE "Family" SET features=json_set(features,'$.calendar',json('false')) WHERE id='event-read-a'`).run()
  check(await readD1EventNotificationFocus(owner, 'event-a', db) === null, 'focus feature gate')
  await db.prepare(`UPDATE "Family" SET features=json_set(features,'$.calendar',json('true')) WHERE id='event-read-a'`).run()
  await db.prepare(`UPDATE "User" SET token_version=1 WHERE id='event-read-parent'`).run()
  check(await readD1CalendarViewer(owner.actorId, 0, db) === null && (await readD1CalendarEvents(owner, { range }, db)).length === 0 && await readD1EventNotificationFocus(owner, 'event-a', db) === null, 'revoked read authority')
  await db.prepare(`UPDATE "User" SET token_version=0,role='teen' WHERE id='event-read-parent'`).run()
  check((await readD1CalendarEvents(owner, { range }, db)).length === 0, 'original role cannot rebind')
  await db.prepare(`UPDATE "User" SET role='parent',family_id='event-read-b' WHERE id='event-read-parent'`).run()
  check((await readD1CalendarEvents(owner, { range }, db)).length === 0, 'original family cannot rebind')
  return { overlapPaging: true, equalTimeCursor: true, datesAndBooleans: true, creatorAndSourcePrivacy: true, householdIsolation: true, recentAndUpcoming: true, exactNotificationFocus: true, liveAuthority: true }
}
