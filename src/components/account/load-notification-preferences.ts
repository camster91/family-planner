/** Keep unopened account controls out of the dashboard's initial JavaScript. */
export async function loadNotificationPreferences() {
  return (await import("./NotificationPreferences")).default;
}
