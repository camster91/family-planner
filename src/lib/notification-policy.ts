// Per-member notification preferences (#286, PR101 D-5).
//
// Pure and client-safe: the server helper (src/lib/notification-delivery.ts),
// the routes and the UI all read the same table, so what a person switches off
// is exactly what the server stops sending.
//
// Every notification the app creates or sends has a type, and every type is
// mapped here, explicitly, to ONE of:
//   * a category a member can mute (a boolean column on User, default true);
//   * ALWAYS: account and safety messages that ignore every switch.
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

export const NOTIFICATION_CATEGORIES = ['chores', 'events', 'messages'] as const
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number]

/** Marker for types no preference can mute. */
export const ALWAYS_SEND = 'always' as const
export type NotificationPolicy = NotificationCategory | typeof ALWAYS_SEND

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
} as const satisfies Record<string, NotificationPolicy>

/** Account email (src/lib/mail.ts). All of it is always sent. */
export const ACCOUNT_MAIL_POLICY = {
  password_reset: ALWAYS_SEND,
  email_verification: ALWAYS_SEND,
  family_invite: ALWAYS_SEND,
} as const satisfies Record<string, typeof ALWAYS_SEND>

export type InAppNotificationType = keyof typeof IN_APP_NOTIFICATION_POLICY
export type AccountMailKind = keyof typeof ACCOUNT_MAIL_POLICY

export const IN_APP_NOTIFICATION_TYPES = Object.keys(IN_APP_NOTIFICATION_POLICY) as [
  InAppNotificationType,
  ...InAppNotificationType[],
]

export function isInAppNotificationType(value: unknown): value is InAppNotificationType {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(IN_APP_NOTIFICATION_POLICY, value)
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

/** Whether a notification of `type` reaches someone with `prefs`. */
export function allowsNotification(type: InAppNotificationType, prefs: NotificationPreferences): boolean {
  const policy: NotificationPolicy = IN_APP_NOTIFICATION_POLICY[type]
  if (policy === ALWAYS_SEND) return true
  return prefs[policy]
}

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
