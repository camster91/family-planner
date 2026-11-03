import { notificationDestination, type NotificationDestination } from './notification-destination'

/** Native ingress is navigation only. The destination rechecks current authority.
 * Keep the raw path strict: URL normalization must not admit encoded aliases. */
export function nativeNotificationDestination(value: unknown): NotificationDestination | null {
  if (typeof value !== 'string' || value.length > 2048) return null
  const match = /^https:\/\/(herewoven\.com|family\.ashbi\.ca)(\/[^\s\\]*)$/.exec(value)
  return match ? notificationDestination(match[2]) : null
}
