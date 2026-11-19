/**
 * Display helpers shared by the in-app handoff page and the public sitter page.
 * They only reshape text the parent already wrote; nothing here adds data.
 */

/** "Fri 9 Jan, 6:00 PM" style: weekday, day, month and time, never seconds.
 * The locale carries the language, region and 12/24-hour preference. */
export function formatHandoffTime(value: string | Date | null | undefined, locale: string): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  try {
    return new Intl.DateTimeFormat(locale, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date)
  } catch {
    return new Intl.DateTimeFormat('en', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date)
  }
}

export type PhoneSegment = { kind: 'text'; text: string } | { kind: 'phone'; text: string; href: string }

// A run that starts with "+", "(" or a digit, may contain spaces, dots, dashes
// and brackets, and ends on a digit. Digit count is checked separately.
const PHONE_CANDIDATE = /\+?\(?\d[\d\s().-]{5,}\d/g
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** `tel:` target for a phone number the parent typed, or null when it does not
 * look like one (7–15 digits, optional leading +). */
export function telHref(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (ISO_DATE.test(trimmed)) return null
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length < 7 || digits.length > 15) return null
  return `tel:${trimmed.startsWith('+') ? '+' : ''}${digits}`
}

/** Split free text into plain text and phone-number segments so numbers can be
 * shown as tap-to-call links while the text stays exactly as written. */
export function splitPhoneNumbers(text: string): PhoneSegment[] {
  const segments: PhoneSegment[] = []
  let last = 0
  for (const match of text.matchAll(PHONE_CANDIDATE)) {
    const start = match.index ?? 0
    // Do not treat a number glued to letters or other digits as a phone number.
    const before = start > 0 ? text[start - 1] : ''
    if (before && /[\p{L}\d]/u.test(before)) continue
    // Trailing spaces/brackets that the pattern cannot end on are already excluded.
    const candidate = match[0].trim()
    const href = telHref(candidate)
    if (!href) continue
    if (start > last) segments.push({ kind: 'text', text: text.slice(last, start) })
    segments.push({ kind: 'phone', text: candidate, href })
    last = start + match[0].length
  }
  if (last < text.length) segments.push({ kind: 'text', text: text.slice(last) })
  return segments
}
