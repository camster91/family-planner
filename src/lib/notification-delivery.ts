// The ONE place the app creates a notification or sends account email
// (#286, PR101 D-5). Policy: src/lib/notification-policy.ts.
//
// * deliverNotification: in-app Notification rows. Reads the recipient's own
//   switch for the type's category and creates nothing when it is off. ALWAYS
//   types ignore the switch. A created row also reports `quiet`: true when the
//   recipient is inside their quiet hours (#141, O-32; src/lib/quiet-hours.ts).
//   The row is stored either way; `quiet` is the signal every interruptive
//   channel (push, sound, toast, reminder email) must honour by holding the
//   interruption. The app has no such channel today.
// * sendAccountMail: password reset, email verification and family invites.
//   Always sent; routed here so the policy table is the full list of what the
//   app sends, and so a new kind has to be added to that table.
// * sendOptInMail: opt-in email (the morning summary, O-38). Sent only to a
//   member who turned it on, with a verified address, outside quiet hours.
//
// src/lib/__tests__/notification-policy.test.ts fails if any other source file
// calls `notification.create` or imports `sendMail`.
import { prisma } from '@/lib/prisma'
import { isMailConfigured, sendMail } from '@/lib/mail'
import {
  ACCOUNT_MAIL_POLICY,
  ALWAYS_SEND,
  CATEGORY_COLUMN,
  IN_APP_NOTIFICATION_POLICY,
  OPT_IN_COLUMN,
  OPT_IN_MAIL_POLICY,
  isOptInPolicy,
  preferencesFromRow,
  type AccountMailKind,
  type InAppNotificationType,
  type NotificationPolicy,
  type OptInMailKind,
} from '@/lib/notification-policy'
import { QUIET_HOURS_SELECT, isInQuietHours, quietHoursFromRow } from '@/lib/quiet-hours'

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
 *
 * `now` is for tests; it decides whether the recipient is in quiet hours.
 */
export async function deliverNotification(input: NotificationInput, now: Date = new Date()) {
  const policy: NotificationPolicy = IN_APP_NOTIFICATION_POLICY[input.type]
  // One read of the recipient's own row: their category switch (unless ALWAYS)
  // and their quiet hours.
  const select: Record<string, true> = { ...QUIET_HOURS_SELECT }
  if (isOptInPolicy(policy)) select[OPT_IN_COLUMN[policy]] = true
  else if (policy !== ALWAYS_SEND) select[CATEGORY_COLUMN[policy]] = true
  const row = (await prisma!.user.findUnique({ where: { id: input.userId }, select })) as Record<
    string,
    boolean | string | null
  > | null
  if (isOptInPolicy(policy)) {
    // Opt-in (O-38): only an explicit `true` lets it through.
    if (row?.[OPT_IN_COLUMN[policy]] !== true) return { delivered: false, notification: null } as const
  } else if (policy !== ALWAYS_SEND && !preferencesFromRow(row as Record<string, boolean> | null)[policy]) {
    return { delivered: false, notification: null } as const
  }
  // Quiet hours never drop a notification: the row is stored, so nothing is
  // lost. They only mark it as not to interrupt (applies to every in-app type,
  // including `system` notices; account mail is not in-app and always sent).
  const quiet = isInQuietHours(now, quietHoursFromRow(row))
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
  return { delivered: true, notification, quiet } as const
}

/** Account email. Always sent: no member preference applies (see the policy). */
export async function sendAccountMail(kind: AccountMailKind, options: Parameters<typeof sendMail>[0]): Promise<void> {
  // The table entry is the documentation; the assertion keeps it honest if a
  // future kind is ever made optional.
  if (ACCOUNT_MAIL_POLICY[kind] !== ALWAYS_SEND) throw new Error(`Account mail "${kind}" must be always-send`)
  await sendMail(options)
}

export type OptInMailResult =
  | { sent: true }
  | { sent: false; reason: 'opted_out' | 'unverified' | 'quiet_hours' | 'mail_not_configured' }

/**
 * Opt-in email (O-38), e.g. the morning summary. Unlike account mail it is
 * sent only when, read fresh from the recipient's own row:
 *   * their switch for the kind is on (opt-in, default off);
 *   * their address is verified (an unverified address may not be theirs);
 *   * they are not inside their quiet hours (O-32: email interrupts);
 *   * mail is configured (`MAILGUN_API_KEY`); without it nothing is sent or
 *     logged, so a summary body never lands in a log.
 * The address is the one on their row; callers cannot choose it. Throws only
 * when the provider fails.
 */
export async function sendOptInMail(
  kind: OptInMailKind,
  options: { userId: string; subject: string; html: string; text: string },
  now: Date = new Date()
): Promise<OptInMailResult> {
  const column = OPT_IN_COLUMN[OPT_IN_MAIL_POLICY[kind]]
  const row = (await prisma!.user.findUnique({
    where: { id: options.userId },
    select: { email: true, email_verified: true, [column]: true, ...QUIET_HOURS_SELECT },
  })) as (Record<string, unknown> & { email?: string | null; email_verified?: boolean | null }) | null
  if (!row || row[column] !== true) return { sent: false, reason: 'opted_out' }
  if (row.email_verified !== true || !row.email) return { sent: false, reason: 'unverified' }
  if (isInQuietHours(now, quietHoursFromRow(row as Parameters<typeof quietHoursFromRow>[0]))) {
    return { sent: false, reason: 'quiet_hours' }
  }
  if (!isMailConfigured()) return { sent: false, reason: 'mail_not_configured' }
  await sendMail({ to: row.email, subject: options.subject, html: options.html, text: options.text })
  return { sent: true }
}
