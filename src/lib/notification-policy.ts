// Per-member notification preferences (#286, PR101 D-5).
//
// Pure and client-safe: the server helper (src/lib/notification-delivery.ts),
// the routes and the UI all read the same table, so what a person switches off
// is exactly what the server stops sending.
//
// Every notification the app creates or sends has a type, and every type is
// mapped here, explicitly, to ONE of:
//   * a category a member can mute (a boolean column on User, default true);
//   * ALWAYS: account and safety messages that ignore every switch;
//   * an OPT-IN kind a member must turn on (a boolean column on User, default
//     false). Today only the morning summary (O-40).
//
// ALWAYS types (documented in docs/architecture/API_CONTRACTS.md):
//   * `system`: household notices a parent sends through POST /api/notifications
//     (e.g. a family announcement). A parent must be able to reach every member.
//   * `password_reset`, `email_verification`, `family_invite`: account email.
//     Muting these would lock people out of their own account or household.
//
// Adding a type: add it to the table below. TypeScript refuses an unmapped type
// at every call site, and src/lib/__tests__/notification-policy.test.ts fails
// if a source file sends a type literal that is not in the table.

import { isValidTimeZone } from '@/lib/quiet-hours'

export const NOTIFICATION_CATEGORIES =['chores', 'events', 'messages'] as const
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number]

/** Marker for types no preference can mute. */
export const ALWAYS_SEND = 'always' as const

/**
 * Opt-in kinds (default OFF): nothing is sent until the member turns the
 * switch on. The morning summary (O-40) is the only one.
 */
export const OPT_IN_KINDS = ['morning_summary'] as const
export type OptInKind = (typeof OPT_IN_KINDS)[number]

/** The User column that holds each opt-in switch (NOT NULL DEFAULT false). */
export const OPT_IN_COLUMN = {
  morning_summary: 'morning_summary_enabled',
} as const satisfies Record<OptInKind, string>

export type NotificationPolicy = NotificationCategory | typeof ALWAYS_SEND | OptInKind

export function isOptInPolicy(policy: NotificationPolicy): policy is OptInKind {
  return (OPT_IN_KINDS as readonly string[]).includes(policy)
}

/** In-app notifications (Notification rows), by `Notification.type`. */
export const IN_APP_NOTIFICATION_POLICY = {
  // A chore given to you, checked or sent back.
  chore: 'chores',
  // Rewards and level-ups: earned by doing chores, so they share its switch.
  reward: 'chores',
  event: 'events',
  message: 'messages',
  // A parent's household notice. Always sent (see above).
  system: ALWAYS_SEND,
  // The daily morning summary (O-40). Opt-in; only the operator-scheduled
  // POST /api/cron/morning-summary sends it (a parent cannot: see
  // isParentSendableType).
  summary: 'morning_summary',
} as const satisfies Record<string, NotificationPolicy>

/** Account email (src/lib/mail.ts). All of it is always sent. */
export const ACCOUNT_MAIL_POLICY = {
  password_reset: ALWAYS_SEND,
  email_verification: ALWAYS_SEND,
  family_invite: ALWAYS_SEND,
} as const satisfies Record<string, typeof ALWAYS_SEND>

/**
 * Opt-in email (src/lib/mail.ts), sent through `sendOptInMail` only to a
 * member who turned the kind on, whose address is verified and who is not in
 * quiet hours (O-32, O-40).
 */
export const OPT_IN_MAIL_POLICY = {
  morning_summary: 'morning_summary',
} as const satisfies Record<string, OptInKind>

export type InAppNotificationType = keyof typeof IN_APP_NOTIFICATION_POLICY
export type AccountMailKind = keyof typeof ACCOUNT_MAIL_POLICY
export type OptInMailKind = keyof typeof OPT_IN_MAIL_POLICY

export const IN_APP_NOTIFICATION_TYPES = Object.keys(IN_APP_NOTIFICATION_POLICY) as [
  InAppNotificationType,
  ...InAppNotificationType[],
]

export function isInAppNotificationType(value: unknown): value is InAppNotificationType {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(IN_APP_NOTIFICATION_POLICY, value)
}

/**
 * Types a parent may send through POST /api/notifications: every table type
 * except opt-in ones, which only their own server sender creates (a parent
 * cannot write a fake "morning summary" into someone's list).
 */
export function isParentSendableType(value: unknown): value is InAppNotificationType {
  return isInAppNotificationType(value) && !isOptInPolicy(IN_APP_NOTIFICATION_POLICY[value])
}

/** The User column that holds each category's switch. */
export const CATEGORY_COLUMN = {
  chores: 'notify_chores',
  events: 'notify_events',
  messages: 'notify_messages',
} as const satisfies Record<NotificationCategory, string>

export type NotificationPreferences = Record<NotificationCategory, boolean>

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  chores: true,
  events: true,
  messages: true,
}

/** Idempotency action name for PATCH /api/users/preferences (#162). */
export const NOTIFICATION_PREFERENCES_ACTION = 'user.notification-preferences.update'

/** Prisma `select` for the three preference columns. */
export const NOTIFICATION_PREFERENCE_SELECT = {
  notify_chores: true,
  notify_events: true,
  notify_messages: true,
} as const

type PreferenceColumn = (typeof CATEGORY_COLUMN)[NotificationCategory]
type PreferenceRow = Partial<Record<PreferenceColumn, boolean | null>>
type PreferenceUpdate = Partial<Record<PreferenceColumn, boolean>>

/**
 * Row -> API shape. Only an explicit `false` mutes: the columns are NOT NULL
 * DEFAULT true, so anything else is the default (today's behaviour).
 */
export function preferencesFromRow(row: PreferenceRow | null | undefined): NotificationPreferences {
  return {
    chores: row?.notify_chores !== false,
    events: row?.notify_events !== false,
    messages: row?.notify_messages !== false,
  }
}

/** API shape (possibly partial) -> the User columns to write. */
export function preferencesToColumns(prefs: Partial<NotificationPreferences>): PreferenceUpdate {
  const out: PreferenceUpdate = {}
  for (const category of NOTIFICATION_CATEGORIES) {
    const value = prefs[category]
    if (typeof value === 'boolean') out[CATEGORY_COLUMN[category]] = value
  }
  return out
}

/**
 * Whether a notification of `type` reaches someone with `prefs`. Opt-in types
 * also need the member's opt-in switch on (`optIn`; missing = off).
 */
export function allowsNotification(
  type: InAppNotificationType,
  prefs: NotificationPreferences,
  optIn: Partial<Record<OptInKind, boolean>> = {}
): boolean {
  const policy: NotificationPolicy = IN_APP_NOTIFICATION_POLICY[type]
  if (policy === ALWAYS_SEND) return true
  if (isOptInPolicy(policy)) return optIn[policy] === true
  return prefs[policy]
}

/**
 * Morning summary switch (O-40) as the API returns it. `timeZone` is the
 * browser's IANA zone saved with the switch (null: none saved).
 */
export interface MorningSummaryPreference {
  enabled: boolean
  timeZone: string | null
}

export const DEFAULT_MORNING_SUMMARY: MorningSummaryPreference = { enabled: false, timeZone: null }

/** Prisma `select` for the morning summary preference columns. */
export const MORNING_SUMMARY_SELECT = {
  morning_summary_enabled: true,
  morning_summary_time_zone: true,
} as const

/** Row -> API shape. Only an explicit `true` turns it on (opt-in, column default false). */
export function morningSummaryFromRow(
  row: { morning_summary_enabled?: boolean | null; morning_summary_time_zone?: string | null } | null | undefined
): MorningSummaryPreference {
  return {
    enabled: row?.morning_summary_enabled === true,
    timeZone: isValidTimeZone(row?.morning_summary_time_zone) ? row!.morning_summary_time_zone! : null,
  }
}

/** Plain words for the morning summary switch (Settings and the user menu). */
export const MORNING_SUMMARY_COPY = {
  label: 'Morning summary',
  description: "One short note each morning with your chores, today's events and dinner. By email and in your list.",
} as const

/** Plain words for the switches (Settings and the user menu). */
export const CATEGORY_COPY: Record<NotificationCategory, { label: string; description: string }> = {
  chores: {
    label: 'Chores and rewards',
    description: 'When a chore is given to you, checked or sent back, and when rewards change.',
  },
  events: {
    label: 'Calendar events',
    description: 'Reminders about things coming up on the family calendar.',
  },
  messages: {
    label: 'Family messages',
    description: 'When someone in the family sends a message.',
  },
}
