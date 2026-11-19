/**
 * Everyday date-and-time display without seconds.
 *
 * Kept apart from `@/lib/dates` on purpose: that module is shared by the
 * dashboard layout and most pages, and pulling it into more screens changes
 * how the build splits the shared shell, which grew every page's initial
 * JavaScript. These two helpers have no dependencies, so callers that only
 * need them import this file. `@/lib/dates` re-exports them.
 */

/**
 * A moment in time for everyday screens: date and time, never seconds
 * ("Jan 5, 2026, 3:04 PM"). Use instead of a bare `toLocaleString(locale)`,
 * which prints seconds. Returns '' for an invalid value.
 */
export function formatDateTime(
  value: Date | string | number,
  locale?: string,
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleString(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** A clock time without seconds ("3:04 PM"). Returns '' for an invalid value. */
export function formatClockTime(
  value: Date | string | number,
  locale?: string,
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleTimeString(locale, {
    hour: "numeric",
    minute: "2-digit",
  });
}
