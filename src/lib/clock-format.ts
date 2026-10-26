/** Device presentation only. Never parse display text back into stored instants. */
export const CLOCK_FORMAT_STORAGE_KEY = "herewoven:clock-format:v1";
export const CLOCK_FORMATS = ["auto", "12h", "24h"] as const;
export type ClockFormat = typeof CLOCK_FORMATS[number];
export function isClockFormat(value: unknown): value is ClockFormat {
  return typeof value === "string" && (CLOCK_FORMATS as readonly string[]).includes(value);
}
export function readClockFormat(): ClockFormat {
  if (typeof window === "undefined") return "auto";
  try {
    const value = window.localStorage.getItem(CLOCK_FORMAT_STORAGE_KEY);
    return isClockFormat(value) ? value : "auto";
  } catch { return "auto"; }
}
export function writeClockFormat(value: ClockFormat): boolean {
  if (!isClockFormat(value) || typeof window === "undefined") return false;
  try {
    if (value === "auto") window.localStorage.removeItem(CLOCK_FORMAT_STORAGE_KEY);
    else window.localStorage.setItem(CLOCK_FORMAT_STORAGE_KEY, value);
    return true;
  } catch { return false; }
}
export function withClockFormat(locale: string, format: ClockFormat): string {
  if (format === "auto") return locale;
  try { return new Intl.Locale(locale, { hourCycle: format === "12h" ? "h12" : "h23" }).toString(); }
  catch { return locale; } // Older Intl implementations keep the usable device format.
}
