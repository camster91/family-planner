// In-app event reminders, D1 side. Twin of src/lib/event-reminders-db.ts; the
// rules live in src/lib/event-reminders.ts.
import { randomUUID } from 'node:crypto'
import { notificationDeliveryDecision } from '@/lib/notification-delivery-policy'
import { eventNotificationDestination } from '@/lib/notification-destination'
import { eventPeopleReady, eventPersonKey } from '@/lib/event-participants'
import {
  REMINDER_MAX_PER_READ, REMINDER_SCAN, REMINDER_WINDOW_MS, eventRemindersReady, reminderIsFor, reminderText, reminderTimeZone,
  type ReminderPerson,
} from '@/lib/event-reminders'
import type { ReminderActor } from '@/lib/event-reminders-db'
import { getD1Database, type D1Store } from './database'
import { readD1HouseholdPeople } from './event-participants'
import { prepareD1NotificationRow } from './notification-delivery'
import { d1WriteCheck, isD1WriteConflict } from './write-check'

type UserRow = {
  family_id: string | null; role: string | null; token_version: number; notify_events: number
  quiet_hours_enabled: number; quiet_hours_start: string | null; quiet_hours_end: string | null
  quiet_hours_time_zone: string | null; morning_summary_time_zone: string | null
}
type DueRow = { id: string; title: string; start_time: number }

/** Write the inbox rows for this account's events that start within the next day. Returns how many were written. */
export async function writeD1DueEventReminders(actor: ReminderActor, browserTimeZone: string | null, now: Date = new Date(), database?: D1Store): Promise<number> {
  if (!eventRemindersReady()) return 0
  const db = (database ?? await getD1Database()).withSession('first-primary')
  const user = await db.prepare(`SELECT family_id,role,token_version,notify_events,quiet_hours_enabled,quiet_hours_start,quiet_hours_end,
      quiet_hours_time_zone,morning_summary_time_zone FROM "User" WHERE id=?1`).bind(actor.userId).first<UserRow>()
  if (!user?.family_id || user.token_version !== actor.generation) return 0
  const familyId = user.family_id
  const timeZone = reminderTimeZone(browserTimeZone, user.quiet_hours_time_zone, user.morning_summary_time_zone)
  if (!timeZone) return 0
  const due = await db.prepare(`SELECT e.id,e.title,e.start_time FROM "Event" e WHERE e.family_id=?1 AND e.start_time>?2 AND e.start_time<=?3
      AND NOT EXISTS (SELECT 1 FROM "EventReminder" r WHERE r.event_id=e.id AND r.user_id=?4) ORDER BY e.start_time ASC,e.id ASC LIMIT ?5`)
    .bind(familyId, now.getTime(), now.getTime() + REMINDER_WINDOW_MS, actor.userId, REMINDER_SCAN).all<DueRow>()
  if (!due.results.length) return 0
  const people = new Map<string, ReminderPerson[]>()
  if (eventPeopleReady()) {
    // People who have since left or been archived no longer count, as on every read.
    const current = await readD1HouseholdPeople(db, familyId)
    const rows = await db.prepare(`SELECT p.event_id,p.user_id,p.member_id FROM "EventParticipant" p JOIN "Event" e ON e.id=p.event_id AND e.family_id=p.family_id
        WHERE p.family_id=?1 AND e.start_time>?2 AND e.start_time<=?3`).bind(familyId, now.getTime(), now.getTime() + REMINDER_WINDOW_MS)
      .all<ReminderPerson & { event_id: string }>()
    for (const row of rows.results) {
      if (!current.has(row.user_id !== null ? eventPersonKey({ kind: 'account', id: row.user_id }) : eventPersonKey({ kind: 'profile', id: row.member_id! }))) continue
      people.set(row.event_id, [...(people.get(row.event_id) ?? []), { user_id: row.user_id, member_id: row.member_id }])
    }
  }
  const decision = notificationDeliveryDecision({
    notify_events: user.notify_events !== 0, quiet_hours_enabled: user.quiet_hours_enabled === 1, quiet_hours_start: user.quiet_hours_start,
    quiet_hours_end: user.quiet_hours_end, quiet_hours_time_zone: user.quiet_hours_time_zone,
  }, 'event', now)
  let written = 0
  for (const event of due.results) {
    if (written >= REMINDER_MAX_PER_READ) break
    if (!reminderIsFor({ id: actor.userId, role: user.role }, people.get(event.id) ?? [])) continue
    const plan = prepareD1NotificationRow(db, { userId: actor.userId, familyId, type: 'event',
      ...reminderText({ title: event.title, start: event.start_time }, timeZone, now.getTime()),
      actionUrl: eventNotificationDestination(event.id) }, decision, now)
    try {
      await db.batch([
        // The account, its mute switch and the event are as they were read; nobody else wrote this reminder meanwhile.
        d1WriteCheck(db, `EXISTS (SELECT 1 FROM "User" WHERE id=?1 AND family_id=?2 AND token_version=?3 AND notify_events=?4)`,
          [actor.userId, familyId, actor.generation, user.notify_events]),
        d1WriteCheck(db, `EXISTS (SELECT 1 FROM "Event" WHERE id=?1 AND family_id=?2 AND start_time=?3 AND title=?4)`, [event.id, familyId, event.start_time, event.title]),
        d1WriteCheck(db, `NOT EXISTS (SELECT 1 FROM "EventReminder" WHERE event_id=?1 AND user_id=?2)`, [event.id, actor.userId]),
        // The proof stays even when the category is muted, so unmuting never replays an old event.
        db.prepare(`INSERT INTO "EventReminder" (id,event_id,family_id,user_id,created_at) VALUES (?1,?2,?3,?4,?5)`)
          .bind(randomUUID(), event.id, familyId, actor.userId, now.getTime()),
        ...plan.statements,
      ])
      if (plan.result.delivered) written += 1
    } catch (cause) {
      // Something changed under this read; the next read looks again.
      if (isD1WriteConflict(cause)) return written
      throw cause
    }
  }
  return written
}
