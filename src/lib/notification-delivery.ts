// The ONE place the app creates a notification or sends account email
// (#286, PR101 D-5). Policy: src/lib/notification-policy.ts.
//
// * deliverNotification: in-app Notification rows. Reads the recipient's own
//   switch for the type's category and creates nothing when it is off. ALWAYS
//   types skip the read.
// * sendAccountMail: password reset, email verification and family invites.
//   Always sent; routed here so the policy table is the full list of what the
//   app sends, and so a new kind has to be added to that table.
//
// src/lib/__tests__/notification-policy.test.ts fails if any other source file
// calls `notification.create` or imports `sendMail`.
import { prisma } from '@/lib/prisma'
import { sendMail } from '@/lib/mail'
import {
  ACCOUNT_MAIL_POLICY,
  ALWAYS_SEND,
  CATEGORY_COLUMN,
  IN_APP_NOTIFICATION_POLICY,
  preferencesFromRow,
  type AccountMailKind,
  type InAppNotificationType,
  type NotificationPolicy,
} from '@/lib/notification-policy'

export interface NotificationInput {
  userId: string
  title: string
  message: string
  type: InAppNotificationType
  actionUrl?: string | null
}

/**
 * Create one in-app notification unless the recipient switched its category
 * off. Throws on a database error; callers that must never fail on a
 * notification (most routes) wrap it, as they did before.
 */
export async function deliverNotification(input: NotificationInput) {
  const policy: NotificationPolicy = IN_APP_NOTIFICATION_POLICY[input.type]
  if (policy !== ALWAYS_SEND) {
    const column = CATEGORY_COLUMN[policy]
    const row = await prisma!.user.findUnique({ where: { id: input.userId }, select: { [column]: true } })
    if (!preferencesFromRow(row as Record<string, boolean> | null)[policy]) {
      return { delivered: false, notification: null } as const
    }
  }
  const notification = await prisma!.notification.create({
    data: {
      user_id: input.userId,
      title: input.title,
      message: input.message,
      type: input.type,
      read: false,
      ...(input.actionUrl ? { action_url: input.actionUrl } : {}),
    },
  })
  return { delivered: true, notification } as const
}

/** Account email. Always sent: no member preference applies (see the policy). */
export async function sendAccountMail(kind: AccountMailKind, options: Parameters<typeof sendMail>[0]): Promise<void> {
  // The table entry is the documentation; the assertion keeps it honest if a
  // future kind is ever made optional.
  if (ACCOUNT_MAIL_POLICY[kind] !== ALWAYS_SEND) throw new Error(`Account mail "${kind}" must be always-send`)
  await sendMail(options)
}
