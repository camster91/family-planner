import {
  parseDateOnly,
  toDateOnlyUTC,
  toDateOnlyLocal,
  addUTCDays,
  startOfTodayUTC,
  parseYearMonth,
  utcMonthRange,
  localDateTimeToISO,
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
