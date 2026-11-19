/** Keep unopened account controls out of the dashboard's initial JavaScript. */
export async function loadNotificationPreferences() {
  return (await import("./NotificationPreferences")).default;
}

/** Quiet view, shown under the notification switches in a child's user menu. */
export async function loadQuietDisplayControl() {
  return (await import("./QuietDisplayControl")).QuietDisplayControl;
}
