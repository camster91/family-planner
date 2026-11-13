// In-app event reminders, PostgreSQL side. Called from the inbox read; see
// src/lib/event-reminders.ts for the rules and src/lib/cloudflare/event-reminders.ts
// for the D1 twin.
import { randomUUID } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { deliverNotificationInTx } from '@/lib/notification-delivery'
import { eventNotificationDestination } from '@/lib/notification-destination'
import { lockHousehold, lockUser } from '@/lib/household-lock'
import { eventPeopleReady, eventPersonKey } from '@/lib/event-participants'
import { readHouseholdPeople } from '@/lib/event-participants-db'
import {
  REMINDER_MAX_PER_READ, REMINDER_SCAN, REMINDER_WINDOW_MS, eventRemindersReady, reminderIsFor, reminderText, reminderTimeZone,
} from '@/lib/event-reminders'

export type ReminderActor = { userId: string; generation: number }

/**
 * Write the inbox rows for this account's events that start within the next
 * day and were not considered before. Returns how many rows were written.
 * Throws on a database error; the inbox read wraps it.
 */
export async function writeDueEventReminders(db: Pick<PrismaClient, '$transaction' | 'event' | 'user'>, actor: ReminderActor,
  browserTimeZone: string | null, now: Date = new Date()): Promise<number> {
  if (!eventRemindersReady()) return 0
  const horizon = new Date(now.getTime() + REMINDER_WINDOW_MS)
  const due = (familyId: string) => ({ family_id: familyId, start_time: { gt: now, lte: horizon }, reminders: { none: { user_id: actor.userId } } })
  // Most reads have nothing due: answer that without taking a lock.
  const account = await db.user.findUnique({ where: { id: actor.userId }, select: { family_id: true, token_version: true } })
  if (!account?.family_id || account.token_version !== actor.generation) return 0
  const familyId = account.family_id
  if (!(await db.event.findFirst({ where: due(familyId), select: { id: true } }))) return 0
  return db.$transaction(async (tx) => {
    await lockUser(tx, actor.userId)
    await lockHousehold(tx, familyId)
    const user = await tx.user.findUnique({ where: { id: actor.userId },
      select: { family_id: true, role: true, token_version: true, quiet_hours_time_zone: true, morning_summary_time_zone: true } })
    if (!user || user.family_id !== familyId || user.token_version !== actor.generation) return 0
    const timeZone = reminderTimeZone(browserTimeZone, user.quiet_hours_time_zone, user.morning_summary_time_zone)
    if (!timeZone) return 0
    const events = await tx.event.findMany({ where: due(familyId), orderBy: [{ start_time: 'asc' }, { id: 'asc' }], take: REMINDER_SCAN,
      select: { id: true, title: true, start_time: true, participants: { select: { user_id: true, member_id: true } } } })
    // People who have since left or been archived no longer count, as on every read.
    const current = eventPeopleReady() ? await readHouseholdPeople(tx, familyId) : null
    let written = 0
    for (const event of events) {
      if (written >= REMINDER_MAX_PER_READ) break
      const people = current ? event.participants.filter((person) => current.has(person.user_id !== null
        ? eventPersonKey({ kind: 'account', id: person.user_id }) : eventPersonKey({ kind: 'profile', id: person.member_id! }))) : []
      if (!reminderIsFor({ id: actor.userId, role: user.role }, people)) continue
      // The proof first: it stays even when the category is muted, so unmuting never replays an old event.
      const proof = await tx.$queryRaw<Array<{ id: string }>>`INSERT INTO "EventReminder" ("id","event_id","family_id","user_id")
        VALUES (${randomUUID()}, ${event.id}, ${familyId}, ${actor.userId}) ON CONFLICT ("event_id","user_id") DO NOTHING RETURNING "id"`
      if (!proof.length) continue
      const result = await deliverNotificationInTx(tx, { userId: actor.userId, familyId, type: 'event',
        ...reminderText({ title: event.title, start: event.start_time.getTime() }, timeZone, now.getTime()),
        actionUrl: eventNotificationDestination(event.id) }, now)
      if (result.delivered) written += 1
    }
    return written
  })
}
