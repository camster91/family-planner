import {
  parseDateOnly,
  toDateOnlyUTC,
  toDateOnlyLocal,
  addUTCDays,
  startOfTodayUTC,
  parseYearMonth,
  utcMonthRange,
  localDateTimeToISO,
  formatDateOnly,
  formatRelativeDueDate,
  isDueToday,
  isDueWithinDays,
  normalizeDateOnlyInput,
  snoozedDueDate,
  eventFormRange,
  nextAnnualOccurrence,
  isoToLocalDateTimeInput,
  formatRelativePastDate,
} from '../dates'

describe('parseDateOnly', () => {
  it('parses YYYY-MM-DD to UTC midnight', () => {
    expect(parseDateOnly('2026-09-24')?.toISOString()).toBe('2026-09-24T00:00:00.000Z')
  })
  it('rejects bad formats and overflow dates', () => {
    for (const v of ['2026-9-24', '2026-09-24T00:00', '', 'abc', '2026-02-31', '2026-13-01', null, 42]) {
      expect(parseDateOnly(v)).toBeNull()
    }
  })
})

describe('toDateOnlyUTC / toDateOnlyLocal', () => {
  it('takes the UTC date part', () => {
    expect(toDateOnlyUTC('2026-09-24T00:00:00.000Z')).toBe('2026-09-24')
    expect(toDateOnlyUTC(new Date('2026-09-24T23:30:00.000Z'))).toBe('2026-09-24')
  })
  it('formats local calendar day', () => {
    expect(toDateOnlyLocal(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
  })
})

describe('addUTCDays / startOfTodayUTC', () => {
  it('adds days across month boundaries', () => {
    expect(addUTCDays(new Date('2026-09-28T00:00:00Z'), 7).toISOString()).toBe('2026-10-05T00:00:00.000Z')
  })
  it('truncates to UTC midnight', () => {
    expect(startOfTodayUTC(new Date('2026-09-24T22:15:00Z')).toISOString()).toBe('2026-09-24T00:00:00.000Z')
  })
})

describe('parseYearMonth / utcMonthRange', () => {
  it('parses strict YYYY-MM', () => {
    expect(parseYearMonth('2026-09')).toEqual({ year: 2026, month: 9 })
    for (const v of ['2026-9', '2026-13', '2026-00', '09', '2026-09-01', '']) {
      expect(parseYearMonth(v)).toBeNull()
    }
  })
  it('builds an exclusive UTC window and rolls over', () => {
    const r = utcMonthRange(2026, 12)
    expect(r.start.toISOString()).toBe('2026-12-01T00:00:00.000Z')
    expect(r.end.toISOString()).toBe('2027-01-01T00:00:00.000Z')
    expect(utcMonthRange(2026, -3).start.toISOString()).toBe('2025-09-01T00:00:00.000Z')
  })
})

describe('localDateTimeToISO', () => {
  it('returns an ISO string equal to local parse', () => {
    expect(localDateTimeToISO('2026-09-24T15:00')).toBe(new Date(2026, 8, 24, 15, 0).toISOString())
  })
  it('returns null for invalid input', () => {
    expect(localDateTimeToISO('nope')).toBeNull()
  })
})

describe('eventFormRange (calendar create/edit)', () => {
  const local = (y: number, m: number, d: number, h: number, min: number) => new Date(y, m - 1, d, h, min).toISOString()
  it('an end time with no end date ends on the start day', () => {
    expect(eventFormRange({ startDate: '2026-10-03', startTime: '15:00', endDate: '', endTime: '16:00' })).toEqual({
      start: local(2026, 10, 3, 15, 0),
      end: local(2026, 10, 3, 16, 0),
    })
  })
  it('an end date with no time ends at 23:59 that day', () => {
    expect(eventFormRange({ startDate: '2026-10-03', startTime: '', endDate: '2026-10-04', endTime: '' })?.end).toBe(
      local(2026, 10, 4, 23, 59)
    )
  })
  it('no end at all means the start instant', () => {
    const r = eventFormRange({ startDate: '2026-10-03', startTime: '09:30', endDate: '', endTime: '' })
    expect(r?.end).toBe(r?.start)
  })
  it('no start date or an unparseable value is null', () => {
    expect(eventFormRange({ startDate: '', startTime: '09:30', endDate: '', endTime: '' })).toBeNull()
    expect(eventFormRange({ startDate: '2026-10-03', startTime: '9pm', endDate: '', endTime: '' })).toBeNull()
  })
})

describe('chore due-date helpers west of UTC', () => {
  const originalTZ = process.env.TZ
  beforeAll(() => {
    process.env.TZ = 'America/Toronto'
  })
  afterAll(() => {
    process.env.TZ = originalTZ
  })

  // Stored due date: UTC midnight of 2026-01-05 (that is Jan 4, 19:00 in Toronto).
  const due = '2026-01-05T00:00:00.000Z'
  // Viewer's local time: Monday 2026-01-05 07:00 in Toronto.
  const now = new Date(2026, 0, 5, 7, 0)

  it('formats the stored calendar day, not the shifted local day', () => {
    expect(formatDateOnly(due)).toBe('Jan 5')
    expect(formatDateOnly(new Date(due))).toBe('Jan 5')
  })
  it('compares the UTC date part with the local calendar day', () => {
    expect(isDueToday(due, now)).toBe(true)
    expect(isDueToday('2026-01-06T00:00:00.000Z', now)).toBe(false)
  })
  it('labels today, tomorrow and later dates', () => {
    expect(formatRelativeDueDate(due, now)).toBe('Today')
    expect(formatRelativeDueDate('2026-01-06T00:00:00.000Z', now)).toBe('Tomorrow')
    expect(formatRelativeDueDate('2026-01-07T00:00:00.000Z', now)).toBe('Jan 7')
    // Late evening locally is already the next UTC day; the label must not move.
    expect(formatRelativeDueDate(due, new Date(2026, 0, 5, 22, 30))).toBe('Today')
  })
  it('keeps today inside a 7-day window', () => {
    expect(isDueWithinDays(due, 7, now)).toBe(true)
    expect(isDueWithinDays('2026-01-12T00:00:00.000Z', 7, now)).toBe(true)
    expect(isDueWithinDays('2026-01-13T00:00:00.000Z', 7, now)).toBe(false)
    expect(isDueWithinDays('2026-01-04T00:00:00.000Z', 7, now)).toBe(false)
  })
})

describe('normalizeDateOnlyInput', () => {
  it('parses YYYY-MM-DD to UTC midnight', () => {
    expect(normalizeDateOnlyInput('2026-09-26')?.toISOString()).toBe('2026-09-26T00:00:00.000Z')
  })
  it('truncates a timestamp to its UTC calendar day', () => {
    expect(normalizeDateOnlyInput('2026-09-26T23:59:59.999Z')?.toISOString()).toBe('2026-09-26T00:00:00.000Z')
    expect(normalizeDateOnlyInput('2026-09-26T20:00:00-07:00')?.toISOString()).toBe('2026-09-27T00:00:00.000Z')
  })
  it('rejects overflow days, garbage and non-strings', () => {
    expect(normalizeDateOnlyInput('2026-02-31')).toBeNull()
    expect(normalizeDateOnlyInput('soon')).toBeNull()
    expect(normalizeDateOnlyInput('')).toBeNull()
    expect(normalizeDateOnlyInput(123)).toBeNull()
    expect(normalizeDateOnlyInput(undefined)).toBeNull()
  })
})

describe('snoozedDueDate west of UTC', () => {
  const originalTZ = process.env.TZ
  beforeAll(() => {
    process.env.TZ = 'America/Toronto'
  })
  afterAll(() => {
    process.env.TZ = originalTZ
  })

  // Viewer's local time: Monday 2026-01-05 22:30 in Toronto (already Jan 6 in UTC).
  const now = new Date(2026, 0, 5, 22, 30)

  it('moves a chore due today to tomorrow (local), as a date-only value', () => {
    expect(snoozedDueDate('2026-01-05T00:00:00.000Z', now)).toBe('2026-01-06')
  })
  it('moves an overdue chore to tomorrow, not the day after its old due date', () => {
    expect(snoozedDueDate('2026-01-01T00:00:00.000Z', now)).toBe('2026-01-06')
  })
  it('moves a future chore back by one day rather than pulling it forward', () => {
    expect(snoozedDueDate('2026-01-09T00:00:00.000Z', now)).toBe('2026-01-10')
  })
  it('crosses month and year boundaries', () => {
    expect(snoozedDueDate('2026-12-31T00:00:00.000Z', new Date(2026, 11, 31, 9, 0))).toBe('2027-01-01')
  })
  it('falls back to tomorrow for a malformed stored value', () => {
    expect(snoozedDueDate('garbage', now)).toBe('2026-01-06')
  })
})

describe('nextAnnualOccurrence', () => {
  const birthday = '1990-03-15T00:00:00.000Z'

  it('is 0 days away on the day itself, not next year', () => {
    const next = nextAnnualOccurrence(birthday, '2026-03-15')
    expect(next?.daysUntil).toBe(0)
    expect(next?.date.toISOString()).toBe('2026-03-15T00:00:00.000Z')
  })
  it('counts whole calendar days to a later date this year', () => {
    expect(nextAnnualOccurrence(birthday, '2026-03-14')?.daysUntil).toBe(1)
    expect(nextAnnualOccurrence(birthday, '2026-03-01')?.daysUntil).toBe(14)
  })
  it('rolls a passed date to next year', () => {
    const next = nextAnnualOccurrence(birthday, '2026-03-16')
    expect(next?.daysUntil).toBe(364)
    expect(next?.date.toISOString()).toBe('2027-03-15T00:00:00.000Z')
  })
  it('accepts a Date and rejects malformed input', () => {
    expect(nextAnnualOccurrence(new Date(birthday), '2026-03-15')?.daysUntil).toBe(0)
    expect(nextAnnualOccurrence('garbage', '2026-03-15')).toBeNull()
    expect(nextAnnualOccurrence(birthday, 'today')).toBeNull()
  })
})

// Jest workers ignore a runtime process.env.TZ change, so these hold in any
// zone; run with TZ=America/Toronto to exercise a west-of-UTC offset.
describe('local date/time helpers (runtime time zone)', () => {
  it('round-trips a datetime-local value through the stored instant', () => {
    const iso = localDateTimeToISO('2026-10-03T18:30')
    expect(iso).toBe(new Date(2026, 9, 3, 18, 30).toISOString())
    expect(isoToLocalDateTimeInput(iso as string)).toBe('2026-10-03T18:30')
  })
  it('pre-fills a stored instant in local time, not its UTC wall clock', () => {
    // 21:00 local on Oct 3 is 01:00Z on Oct 4 in Toronto (UTC-4).
    const stored = new Date(2026, 9, 3, 21, 0).toISOString()
    expect(isoToLocalDateTimeInput(stored)).toBe('2026-10-03T21:00')
    expect(isoToLocalDateTimeInput('nope')).toBe('')
  })
  it('labels a UTC-midnight date by its calendar day relative to local today', () => {
    // Evening of Oct 1 local time (already Oct 2 in UTC west of UTC).
    const now = new Date(2026, 9, 1, 21, 0)
    expect(formatRelativePastDate('2026-10-01T00:00:00.000Z', now)).toBe('Today')
    expect(formatRelativePastDate('2026-09-30T00:00:00.000Z', now)).toBe('Yesterday')
    expect(formatRelativePastDate('2026-09-29T00:00:00.000Z', now)).toBe('Sep 29')
  })
})
