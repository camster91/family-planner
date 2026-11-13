import { readD1ReminderLeadHours, writeD1DueEventReminders, writeD1ReminderLeadHours } from '../../../src/lib/cloudflare/event-reminders'
import { EVENT_REMINDERS_READY_ENV } from '../../../src/lib/event-reminders'
import { EVENT_PEOPLE_READY_ENV } from '../../../src/lib/event-participants'
import type { D1Store } from '../../../src/lib/cloudflare/database'
function check(value: unknown, label: string): asserts value { if (!value) throw new Error(label) }
/** In-app event reminders: real workerd/D1, two households, capability on and off. */
export async function testEventReminders(db: D1Store) {
  await db.prepare(`INSERT INTO "Family" (id,name,invite_code) VALUES ('remind-a','Fixture','remind-a'),('remind-b','Other','remind-b')`).run()
  await db.prepare(`INSERT INTO "User" (id,email,name,family_id,role,created_at) VALUES
    ('remind-parent','remind-parent@example.test','Parent','remind-a','parent',1),
    ('remind-teen','remind-teen@example.test','Teen','remind-a','teen',2),
    ('remind-foreign','remind-foreign@example.test','Foreign','remind-b','parent',3)`).run()
  await db.prepare(`INSERT INTO "HouseholdMember" (id,family_id,name,role,created_at) VALUES ('remind-kid','remind-a','Kid','child',4)`).run()
  const TZ = 'America/Toronto', HOUR = 3_600_000
  const now = new Date('2026-06-10T16:00:00.000Z') // noon in Toronto
  const parent = { userId: 'remind-parent', generation: 0 }, teen = { userId: 'remind-teen', generation: 0 }, foreign = { userId: 'remind-foreign', generation: 0 }
  const event = (id: string, startsInMs: number, title: string, family = 'remind-a', by = 'remind-parent') =>
    db.prepare(`INSERT INTO "Event" (id,family_id,title,start_time,end_time,created_by) VALUES (?1,?2,?3,?4,?5,?6)`)
      .bind(id, family, title, now.getTime() + startsInMs, now.getTime() + startsInMs + HOUR, by).run()
  type Row = { title: string; message: string; type: string; read: number; action_url: string | null }
  const inbox = async (userId: string) => (await db.prepare(`SELECT title,message,type,read,action_url FROM "Notification" WHERE user_id=?1 ORDER BY created_at,title`).bind(userId).all<Row>()).results
  const proofs = async (where = `family_id='remind-a'`) => (await db.prepare(`SELECT count(*) AS n FROM "EventReminder" WHERE ${where}`).first<{ n: number }>())!.n
  const write = (actor: typeof parent, zone: string | null, at = now) => writeD1DueEventReminders(actor, zone, at, db)
  const refused = async (sql: string) => { try { await db.prepare(sql).run(); return false } catch { return true } }

  await event('remind-soon', 2 * HOUR, '  Swim   lesson ')
  await event('remind-tomorrow', 20 * HOUR, 'Brunch')
  await event('remind-later', 25 * HOUR, 'Too far')
  await event('remind-started', -HOUR / 2, 'Already on')

  // Off, an unknown zone or a stale session: nothing is written.
  process.env[EVENT_PEOPLE_READY_ENV] = '1'
  process.env[EVENT_REMINDERS_READY_ENV] = '0'
  check(await write(parent, TZ) === 0, 'off writes nothing')
  process.env[EVENT_REMINDERS_READY_ENV] = '1'
  check(await write(parent, 'Mars/Olympus') === 0 && await write(parent, null) === 0 && await write({ userId: 'remind-parent', generation: 7 }, TZ) === 0
    && (await inbox('remind-parent')).length === 0 && await proofs() === 0, 'unknown zone and stale session write nothing')

  // Due events are written once, in local time, with a link.
  check(await write(parent, TZ) === 2, 'two due events')
  const first = await inbox('remind-parent')
  check(first.length === 2 && first.every(r => r.type === 'event' && r.read === 0)
    && first.some(r => r.title === 'Coming up: Swim lesson' && r.message === 'Today at 2:00 PM' && r.action_url === '/dashboard/calendar?focus=remind-soon')
    && first.some(r => r.title === 'Coming up: Brunch' && r.message === 'Tomorrow at 8:00 AM' && r.action_url === '/dashboard/calendar?focus=remind-tomorrow'), 'reminder text, type and link')
  const again = await Promise.all([write(parent, TZ), write(parent, TZ)])
  check(again[0] === 0 && again[1] === 0 && (await inbox('remind-parent')).length === 2, 'no second copy, even in a race')
  check(await write(parent, TZ, new Date(now.getTime() + HOUR)) === 1 && (await inbox('remind-parent')).some(r => r.title === 'Coming up: Too far'), 'the far event is due an hour later')

  // Deleted and muted reminders never come back.
  await db.prepare(`DELETE FROM "Notification" WHERE user_id='remind-parent'`).run()
  check(await write(parent, TZ, new Date(now.getTime() + HOUR)) === 0 && (await inbox('remind-parent')).length === 0, 'a deleted reminder stays deleted')
  await db.prepare(`UPDATE "User" SET notify_events=0 WHERE id='remind-teen'`).run()
  check(await write(teen, TZ) === 0 && await proofs(`user_id='remind-teen'`) === 2, 'muted: proof without an inbox row')
  await db.prepare(`UPDATE "User" SET notify_events=1 WHERE id='remind-teen'`).run()
  check(await write(teen, TZ) === 0 && (await inbox('remind-teen')).length === 0, 'unmuting does not replay')

  // Who the event is for; a parent stands in for a person without an account.
  await event('remind-teen-only', 3 * HOUR, 'Band')
  await event('remind-kid-only', 4 * HOUR, 'Checkup')
  await db.prepare(`INSERT INTO "EventParticipant" (id,event_id,family_id,user_id,member_id) VALUES
    ('remind-p1','remind-teen-only','remind-a','remind-teen',NULL),('remind-p2','remind-kid-only','remind-a',NULL,'remind-kid')`).run()
  check(await write(parent, TZ) === 1 && await write(teen, TZ) === 1, 'one each')
  check((await inbox('remind-parent')).map(r => r.title).join() === 'Coming up: Checkup' && (await inbox('remind-teen')).map(r => r.title).join() === 'Coming up: Band', 'named people only; parent for the profile')
  process.env[EVENT_PEOPLE_READY_ENV] = '0'
  check(await write(parent, TZ) === 1 && (await inbox('remind-parent')).some(r => r.title === 'Coming up: Band'), 'people off: every event is the whole family\'s')

  // Households stay apart; the database refuses a foreign account and identity edits.
  check(await write(foreign, TZ) === 0 && (await inbox('remind-foreign')).length === 0, 'another household sees nothing')
  await event('remind-b-event', 2 * HOUR, 'B event', 'remind-b', 'remind-foreign')
  check(await write(foreign, TZ) === 1 && await write(parent, TZ) === 0 && (await inbox('remind-foreign')).map(r => r.title).join() === 'Coming up: B event', 'each household gets its own')
  check(await refused(`INSERT INTO "EventReminder" (id,event_id,family_id,user_id) VALUES ('remind-x','remind-later','remind-a','remind-foreign')`), 'foreign account refused')
  check(await refused(`UPDATE "EventReminder" SET user_id='remind-teen' WHERE user_id='remind-parent'`), 'identity is immutable')
  // Each account's own lead time.
  await event('remind-in-3d', 72 * HOUR, 'In three days')
  check(await readD1ReminderLeadHours(teen, db) === 24 && await readD1ReminderLeadHours({ userId: 'remind-teen', generation: 4 }, db) === null, 'default lead; stale session reads nothing')
  check(await writeD1ReminderLeadHours({ userId: 'remind-teen', generation: 4 }, 168, now, db) === false && await writeD1ReminderLeadHours(teen, 168, now, db) === true
    && await writeD1ReminderLeadHours(teen, 168, now, db) === true && await readD1ReminderLeadHours(teen, db) === 168, 'own lead saved; stale session refused')
  check(await write(parent, TZ) === 0 && await write(teen, TZ) >= 1
    && (await inbox('remind-teen')).some(r => r.title === 'Coming up: In three days' && r.message === 'Sat, Jun 13 at 12:00 PM'), 'a week-long lead reaches further, with the date spelled out')
  check(await refused(`UPDATE "EventReminderPreference" SET hours=5 WHERE user_id='remind-teen'`), 'unknown lead refused by the database')
  const before = await proofs()
  await db.prepare(`DELETE FROM "Event" WHERE id='remind-soon'`).run()
  check(await proofs() < before, 'deleting the event removes its proof')
  delete process.env[EVENT_REMINDERS_READY_ENV]; delete process.env[EVENT_PEOPLE_READY_ENV]
  return { off: true, zoneAndSession: true, writtenOnce: true, deletedStaysDeleted: true, mutedIsTerminal: true, audience: true, scoped: true, ownLeadTime: true, databaseGuard: true }
}
