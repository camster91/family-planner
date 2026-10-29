/** Storage-independent delivery policy. Account mail keeps its own always-send path. */
import {
  ALWAYS_SEND, CATEGORY_COLUMN, IN_APP_NOTIFICATION_POLICY, OPT_IN_COLUMN,
  isOptInPolicy, preferencesFromRow, type InAppNotificationType,
} from './notification-policy'
import { QUIET_HOURS_SELECT, isInQuietHours, quietHoursFromRow } from './quiet-hours'

type PolicyRow = Partial<Record<string, boolean | string | number | null>>
export function notificationDeliverySelect(type: InAppNotificationType): Record<string, true> {
  const policy = IN_APP_NOTIFICATION_POLICY[type]
  const select: Record<string, true> = { ...QUIET_HOURS_SELECT }
  if (isOptInPolicy(policy)) select[OPT_IN_COLUMN[policy]] = true
  else if (policy !== ALWAYS_SEND) select[CATEGORY_COLUMN[policy]] = true
  return select
}
export function notificationDeliveryDecision(row: PolicyRow | null, type: InAppNotificationType, now: Date) {
  const policy = IN_APP_NOTIFICATION_POLICY[type]
  if (isOptInPolicy(policy)) {
    if (row?.[OPT_IN_COLUMN[policy]] !== true) return { deliver: false } as const
  } else if (policy !== ALWAYS_SEND && !preferencesFromRow(row as Record<string, boolean> | null)[policy]) {
    return { deliver: false } as const
  }
  return { deliver: true, quiet: isInQuietHours(now, quietHoursFromRow(row)) } as const
}
