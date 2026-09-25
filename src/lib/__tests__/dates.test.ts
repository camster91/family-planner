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
