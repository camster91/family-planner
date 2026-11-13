import { storageBackend } from '@/lib/storage-backend'
import { prisma } from '@/lib/prisma'
import { eventRemindersReady } from '@/lib/event-reminders'
import type { ReminderActor } from '@/lib/event-reminders-db'

/**
 * Before an inbox read: write this account's due event reminders. There is no
 * scheduler, so the read is what makes them appear. It must never fail the read.
 */
export async function writeEventRemindersOnRead(actor: ReminderActor, browserTimeZone: string | null, now: Date = new Date()): Promise<void> {
  if (!eventRemindersReady()) return
  try {
    if (storageBackend() === 'd1') {
      const { writeD1DueEventReminders } = await import('@/lib/cloudflare/event-reminders')
      await writeD1DueEventReminders(actor, browserTimeZone, now)
    } else {
      const { writeDueEventReminders } = await import('@/lib/event-reminders-db')
      await writeDueEventReminders(prisma!, actor, browserTimeZone, now)
    }
  } catch (error) {
    console.warn('[event-reminders] skipped', error instanceof Error ? error.name : 'unknown')
  }
}
