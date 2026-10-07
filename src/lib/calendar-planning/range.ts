// Person-session planning reads use concrete instants, never date-only or RRULE expansion.
export class CalendarRangeError extends Error {}
export const CALENDAR_RANGE_MAX_MS = 45 * 24 * 60 * 60 * 1000
export const CALENDAR_RANGE_MAX_LIMIT = 200

/** Strict millisecond-precision ISO instant; reject Date's rollover repairs. */
export function parseCalendarInstant(value: string | null): Date {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/)
  if (!match) throw new CalendarRangeError('Invalid calendar instant')
  const [, y, mo, d, h, mi, s, , zone] = match
  const year = Number(y), month = Number(mo), day = Number(d)
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] ||
      Number(h) > 23 || Number(mi) > 59 || Number(s) > 59 ||
      (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59))) {
    throw new CalendarRangeError('Invalid calendar instant')
  }
  const date = new Date(value!)
  // Offset conversion can cross the supported UTC year boundaries.
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) {
    throw new CalendarRangeError('Invalid calendar instant')
  }
  return date
}

export interface CalendarRange {
  start: Date
  end: Date
  limit: number
  after: { start: Date; id: string } | null
}

// This is a validated bookmark, not an authorization token. Every query must
// still carry the authenticated household; never look up a cursor's row by id.
function decodeCursor(raw: string, familyId: string, start: Date, end: Date) {
  try {
    if (!raw || raw.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error()
    const bytes = Buffer.from(raw, 'base64url')
    if (bytes.toString('base64url') !== raw) throw new Error()
    const payload = JSON.parse(bytes.toString('utf8'))
    if (!payload || Array.isArray(payload) ||
        Object.keys(payload).sort().join(',') !== 'end,family,id,start,time,v' ||
        payload.v !== 1 || payload.family !== familyId ||
        payload.start !== start.toISOString() || payload.end !== end.toISOString() ||
        typeof payload.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(payload.id) ||
        typeof payload.time !== 'string') throw new Error()
    const time = parseCalendarInstant(payload.time)
    if (payload.time !== time.toISOString() || time >= end) throw new Error()
    return { start: time, id: payload.id }
  } catch {
    throw new CalendarRangeError('Invalid calendar cursor')
  }
}

export function encodeCalendarCursor(familyId: string, range: CalendarRange, row: { id: string; start_time: Date }): string {
  const time = parseCalendarInstant(row.start_time.toISOString()).toISOString()
  return Buffer.from(JSON.stringify({ v: 1, family: familyId, start: range.start.toISOString(),
    end: range.end.toISOString(), time, id: row.id })).toString('base64url')
}

export function parseCalendarRange(params: URLSearchParams, familyId: string): CalendarRange | null {
  if (!['start', 'end', 'limit', 'cursor'].some(key => params.has(key))) return null
  for (const key of ['start', 'end', 'limit', 'cursor', 'upcoming']) {
    if (params.getAll(key).length > 1) throw new CalendarRangeError('Duplicate calendar parameter')
  }
  if (params.has('upcoming')) throw new CalendarRangeError('Range cannot be combined with upcoming')
  const start = parseCalendarInstant(params.get('start'))
  const end = parseCalendarInstant(params.get('end'))
  const span = end.getTime() - start.getTime()
  if (span <= 0 || span > CALENDAR_RANGE_MAX_MS) throw new CalendarRangeError('Calendar range must be positive and at most 45 days')
  const rawLimit = params.get('limit')
  const limit = rawLimit === null ? CALENDAR_RANGE_MAX_LIMIT : Number(rawLimit)
  if (rawLimit !== null && (!/^[1-9]\d{0,2}$/.test(rawLimit) || limit > CALENDAR_RANGE_MAX_LIMIT)) {
    throw new CalendarRangeError('Calendar limit must be an integer from 1 to 200')
  }
  const after = params.has('cursor') ? decodeCursor(params.get('cursor')!, familyId, start, end) : null
  return { start, end, limit, after }
}
