/** Refresh mounted calendar views after a confirmed canonical event mutation.
 * No record data crosses this signal; each view reloads its authorized range.
 */
export const CALENDAR_CHANGED_EVENT = "herewoven:calendar-changed";

export function notifyCalendarChanged(): void {
  window.dispatchEvent(new Event(CALENDAR_CHANGED_EVENT));
}
