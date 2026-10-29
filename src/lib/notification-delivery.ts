import { storageBackend } from '@/lib/storage-backend'
import { notificationDeliverySelect, notificationDeliveryDecision } from '@/lib/notification-delivery-policy'
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
// * sendOptInMail: opt-in email (the morning summary, O-40). Sent only to a
//   member who turned it on, with a verified address, outside quiet hours.
//
// src/lib/__tests__/notification-policy.test.ts fails if any other source file
// calls `notification.create` or imports `sendMail`.
import { prisma } from '@/lib/prisma'
import { isMailConfigured, sendMail } from '@/lib/mail'
import {
  ACCOUNT_MAIL_POLICY,
  ALWAYS_SEND,
  OPT_IN_COLUMN,
  OPT_IN_MAIL_POLICY,
  type AccountMailKind,
  type InAppNotificationType,
  type OptInMailKind,
} from '@/lib/notification-policy'
import { QUIET_HOURS_SELECT, isInQuietHours, quietHoursFromRow } from '@/lib/quiet-hours'
import { lockHousehold, lockUser } from '@/lib/household-lock'
import type { D1Store } from '@/lib/cloudflare/database'

export interface SummaryRecipientContext {
  role: string
  tokenVersion: number
}

export interface NotificationInput {
  userId: string
  /** Required for household-originated content; retained optional for legacy account notices. */
  familyId?: string
  /** Snapshot required by summary producers; invalidated by removal/rejoin. */
  recipientContext?: SummaryRecipientContext
  /** Manual parent sends revalidate their sender under the same locks. */
  senderId?: string
  /** Optional current session evidence for manual senders, never a credential. */
  senderContext?: SummaryRecipientContext
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
  if (storageBackend() === 'd1') {
    const { deliverD1Notification } = await import('@/lib/cloudflare/notification-delivery')
    return deliverD1Notification(input, now)
  }
  const familyId = input.familyId
  if (familyId) {
    return prisma!.$transaction(async tx => {
      for (const id of [...new Set([input.userId, ...(input.senderId ? [input.senderId] : [])])].sort()) {
        await lockUser(tx, id)
      }
      await lockHousehold(tx, familyId)
      const recipient = await tx.user.findUnique({ where: { id: input.userId }, select: { family_id: true, role: true, token_version: true } })
      if (recipient?.family_id !== familyId) return { delivered: false, notification: null } as const
      if (input.recipientContext && (recipient.role !== input.recipientContext.role ||
        recipient.token_version !== input.recipientContext.tokenVersion)) {
        return { delivered: false, notification: null } as const
      }
      if (input.senderId) {
        const sender = await tx.user.findUnique({ where: { id: input.senderId }, select: { family_id: true, role: true, token_version: true } })
        if (sender?.family_id !== familyId || sender?.role !== 'parent' ||
          (input.senderContext && (sender.role !== input.senderContext.role || sender.token_version !== input.senderContext.tokenVersion))) {
          return { delivered: false, notification: null } as const
        }
      }
      return deliverNotificationInTx(tx, input, now)
    })
  }
  return deliverNotificationInTx(prisma!, input, now)
}

/** Internal primitive only. Caller must hold ordered User/household locks and
 * freshly authorize sender/recipient/source; this does not authenticate callers.
 */
export async function deliverNotificationInTx(db: Pick<NonNullable<typeof prisma>, 'user' | 'notification'>, input: NotificationInput, now: Date) {
  const row = await db.user.findUnique({ where: { id: input.userId }, select: notificationDeliverySelect(input.type) })
  const decision = notificationDeliveryDecision(row as Record<string, boolean | string | null> | null, input.type, now)
  if (!decision.deliver) return { delivered: false, notification: null } as const
  const quiet = decision.quiet
  const notification = await db.notification.create({
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
  | { sent: false; reason: 'opted_out' | 'unverified' | 'quiet_hours' | 'mail_not_configured' | 'membership_changed' }

/**
 * Opt-in email (O-40), e.g. the morning summary. Unlike account mail it is
 * sent only when, read fresh from the recipient's own row:
 *   * their switch for the kind is on (opt-in, default off);
 *   * their address is verified (an unverified address may not be theirs);
 *   * they are not inside their quiet hours (O-32: email interrupts);
 *   * mail is configured (`MAILGUN_API_KEY`); without it nothing is sent or
 *     logged, so a summary body never lands in a log.
 * The address is the one on their row; callers cannot choose it. Throws only
 * when the provider fails.
 */
// A provider request must finish before its membership locks can expire.
const OPT_IN_MAIL_TRANSACTION_MS = 15_000
const OPT_IN_MAIL_PROVIDER_MS = 10_000
const OPT_IN_MAIL_MARGIN_MS = 2_000

export async function sendOptInMail(
  kind: OptInMailKind,
  options: { userId: string; familyId: string; recipientContext: SummaryRecipientContext; subject: string; html: string; text: string },
  now: Date = new Date()
): Promise<OptInMailResult> {
  const column = OPT_IN_COLUMN[OPT_IN_MAIL_POLICY[kind]]
  const deadline = Date.now() + OPT_IN_MAIL_TRANSACTION_MS - OPT_IN_MAIL_MARGIN_MS
  return prisma!.$transaction(async (tx): Promise<OptInMailResult> => {
    // Same order as removal/reassignment. Keep authorization valid through the
    // bounded transport await; account verification/reset mail stays separate.
    await lockUser(tx, options.userId)
    await lockHousehold(tx, options.familyId)
    const row = (await tx.user.findUnique({
      where: { id: options.userId },
      select: { family_id: true, role: true, token_version: true, email: true, email_verified: true, [column]: true, ...QUIET_HOURS_SELECT },
    })) as (Record<string, unknown> & { family_id?: string | null; email?: string | null; email_verified?: boolean | null }) | null
    if (!row || row.family_id !== options.familyId) return { sent: false, reason: 'membership_changed' }
    if (row.role !== options.recipientContext.role || row.token_version !== options.recipientContext.tokenVersion) {
      return { sent: false, reason: 'membership_changed' }
    }
    if (row[column] !== true) return { sent: false, reason: 'opted_out' }
    if (row.email_verified !== true || !row.email) return { sent: false, reason: 'unverified' }
    if (isInQuietHours(now, quietHoursFromRow(row as Parameters<typeof quietHoursFromRow>[0]))) {
      return { sent: false, reason: 'quiet_hours' }
    }
    if (!isMailConfigured()) return { sent: false, reason: 'mail_not_configured' }
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new Error('Opt-in mail authorization deadline expired')
    // An aborted remote request may already have been accepted. The caller's
    // daily claim must remain consumed rather than replaying unknown outcomes.
    await sendMail({
      to: row.email, subject: options.subject, html: options.html, text: options.text,
      signal: AbortSignal.timeout(Math.min(OPT_IN_MAIL_PROVIDER_MS, remaining)),
    })
    return { sent: true }
  }, { timeout: OPT_IN_MAIL_TRANSACTION_MS })
}

/**
 * Native D1 counterpart to sendOptInMail. D1 cannot hold an interactive SQL
 * lock over a provider fetch, so the primary read immediately before sending
 * is the membership/preference/quiet-hours boundary. The caller's daily claim
 * is consumed before this call and therefore remains the dedupe boundary if a
 * provider response is lost or the member changes during the fetch.
 */
export async function sendD1OptInMail(
  database: D1Store,
  options: { userId: string; familyId: string; recipientContext: SummaryRecipientContext; subject: string; html: string; text: string },
  now: Date = new Date(),
): Promise<OptInMailResult> {
  const deadline = Date.now() + OPT_IN_MAIL_TRANSACTION_MS - OPT_IN_MAIL_MARGIN_MS
  const row = await database
    .withSession('first-primary')
    .prepare(`SELECT family_id,role,token_version,email,email_verified,morning_summary_enabled,quiet_hours_enabled,quiet_hours_start,quiet_hours_end,quiet_hours_time_zone FROM "User" WHERE id=?1`)
    .bind(options.userId)
    .first<{
      family_id: string | null
      role: string
      token_version: number
      email: string | null
      email_verified: number | boolean
      morning_summary_enabled: number | boolean
      quiet_hours_enabled: number | boolean
      quiet_hours_start: string | null
      quiet_hours_end: string | null
      quiet_hours_time_zone: string | null
    }>()
  if (!row || row.family_id !== options.familyId || row.role !== options.recipientContext.role || row.token_version !== options.recipientContext.tokenVersion) {
    return { sent: false, reason: 'membership_changed' }
  }
  if (row.morning_summary_enabled !== true && row.morning_summary_enabled !== 1) {
    return { sent: false, reason: 'opted_out' }
  }
  if ((row.email_verified !== true && row.email_verified !== 1) || !row.email) {
    return { sent: false, reason: 'unverified' }
  }
  if (isInQuietHours(now, quietHoursFromRow({
    ...row,
    quiet_hours_enabled: row.quiet_hours_enabled === true || row.quiet_hours_enabled === 1,
  }))) {
    return { sent: false, reason: 'quiet_hours' }
  }
  if (!isMailConfigured()) return { sent: false, reason: 'mail_not_configured' }
  const remaining = deadline - Date.now()
  if (remaining <= 0) throw new Error('Opt-in mail authorization deadline expired')
  await sendMail({
    to: row.email,
    subject: options.subject,
    html: options.html,
    text: options.text,
    signal: AbortSignal.timeout(Math.min(OPT_IN_MAIL_PROVIDER_MS, remaining)),
  })
  return { sent: true }
}
