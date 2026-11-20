/**
 * Dependency-light pieces of the personal inbox for the top bar's bell. The
 * bell's badge loads on every dashboard page, so it imports these from here
 * rather than from notification-read-client, which carries the inbox's
 * bounded reader. notification-read-client re-exports them.
 */
import { REMINDER_TIME_ZONE_HEADER } from "./event-reminder-constants";

/** Fired on window when this page read, snoozed or removed a notification, so the bell can recount. */
export const NOTIFICATIONS_CHANGED_EVENT =
  "family-planner:notifications-changed";

export function announceNotificationsChanged(): void {
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
}

/** The browser's zone for reminder text; empty when the runtime cannot say. */
export function reminderTimeZoneHeaders(): Record<string, string> {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone ? { [REMINDER_TIME_ZONE_HEADER]: zone } : {};
  } catch {
    return {};
  }
}
