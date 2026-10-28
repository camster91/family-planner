/** Native counterpart of the single notification-delivery entrypoint. Source
 * producers still own source authority; this boundary renews recipient/sender
 * membership and preferences atomically with creating their private inbox row. */
import { randomUUID } from 'node:crypto'
import type { Notification } from '@prisma/client'
import type { NotificationInput } from '@/lib/notification-delivery'
import { notificationDeliverySelect, notificationDeliveryDecision } from '@/lib/notification-delivery-policy'
import { getD1Database, type D1Store } from './database'
import { captureD1Reads } from './read-witness'
import type { NativeD1 } from './read-client'
import { isD1WriteConflict } from './write-check'

export async function deliverD1Notification(input: NotificationInput, now = new Date(), database?: D1Store) {
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid notification clock')
  const store = database ?? await getD1Database(), session = store.withSession('first-primary')
  for (let attempt = 0; attempt < 8; attempt++) {
    const captured = await captureD1Reads(async db => {
      const recipient = await db.user.findUnique({ where: { id: input.userId }, select: {
        id: true, family_id: true, role: true, token_version: true,
        ...notificationDeliverySelect(input.type),
      } })
      if (!recipient) return null
      // Legacy account notices without a family retain their account-only scope.
      if (input.familyId) {
        if (recipient.family_id !== input.familyId) return null
        if (input.recipientContext && (recipient.role !== input.recipientContext.role || recipient.token_version !== input.recipientContext.tokenVersion)) return null
        if (input.senderId) {
          const sender = await db.user.findUnique({ where: { id: input.senderId }, select: { family_id: true, role: true, token_version: true } })
          if (sender?.family_id !== input.familyId || sender.role !== 'parent' ||
            (input.senderContext && (sender.role !== input.senderContext.role || sender.token_version !== input.senderContext.tokenVersion))) return null
        }
      }
      return notificationDeliveryDecision(recipient, input.type, now)
    }, store as unknown as NativeD1)
    const checks = captured.checks(session), decision = captured.value
    const notification: Notification = {
      id: randomUUID(), user_id: input.userId, title: input.title, message: input.message,
      type: input.type, read: false, action_url: input.actionUrl || null,
      snoozed_until: null, created_at: now,
    }
    const statements = !decision?.deliver ? checks : [...checks, session.prepare(`INSERT INTO "Notification"(id,user_id,title,message,type,read,action_url,created_at) VALUES (?1,?2,?3,?4,?5,0,?6,?7)`)
      .bind(notification.id, notification.user_id, notification.title, notification.message, notification.type, notification.action_url, now.getTime())]
    try {
      await session.batch(statements)
      if (!decision?.deliver) return { delivered: false, notification: null } as const
      return { delivered: true, notification, quiet: decision.quiet } as const
    } catch (cause) { if (!isD1WriteConflict(cause)) throw cause }
  }
  throw new Error('Notification recipient changed; retry delivery')
}
