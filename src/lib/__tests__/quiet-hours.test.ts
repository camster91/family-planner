// Quiet hours (#141, O-32): the pure window rules, the local-clock reading in
// the saved time zone (including daylight-saving nights), and row mapping.
import {
  DEFAULT_QUIET_HOURS,
  isInQuietHours,
  isValidTimeZone,
  isWithinWindow,
  localMinutes,
  quietHoursFromRow,
  quietHoursProblem,
  quietHoursToColumns,
  type QuietHours,
} from '../quiet-hours'

const m = (hhmm: string) => {
  const [h, min] = hhmm.split(':').map(Number)
  return h * 60 + min
}

const quiet = (over: Partial<QuietHours> = {}): QuietHours => ({
  enabled: true,
  start: '22:00',
  end: '07:00',
  timeZone: null,
  ...over,
})

describe('isWithinWindow', () => {
  it('a same-day window: start inclusive, end exclusive', () => {
    expect(isWithinWindow(m('12:59'), '13:00', '15:00')).toBe(false)
    expect(isWithinWindow(m('13:00'), '13:00', '15:00')).toBe(true)
    expect(isWithinWindow(m('14:59'), '13:00', '15:00')).toBe(true)
    expect(isWithinWindow(m('15:00'), '13:00', '15:00')).toBe(false)
  })

  it('a window that wraps past midnight covers both sides of it', () => {
    for (const t of ['22:00', '23:59', '00:00', '03:15', '06:59']) {
      expect(isWithinWindow(m(t), '22:00', '07:00')).toBe(true)
    }
    for (const t of ['07:00', '12:00', '21:59']) {
      expect(isWithinWindow(m(t), '22:00', '07:00')).toBe(false)
    }
  })

  it('a window ending exactly at midnight, and one starting at midnight', () => {
    expect(isWithinWindow(m('23:59'), '21:00', '00:00')).toBe(true)
    expect(isWithinWindow(m('00:00'), '21:00', '00:00')).toBe(false)
    expect(isWithinWindow(m('00:00'), '00:00', '06:00')).toBe(true)
    expect(isWithinWindow(m('06:00'), '00:00', '06:00')).toBe(false)
  })

  it('equal or malformed times are an empty window', () => {
    expect(isWithinWindow(m('22:00'), '22:00', '22:00')).toBe(false)
    expect(isWithinWindow(m('10:00'), '9:00', '11:00')).toBe(false)
    expect(isWithinWindow(m('10:00'), '09:00', '24:00')).toBe(false)
    expect(isWithinWindow(m('10:00'), 'nope', '11:00')).toBe(false)
  })
})

describe('localMinutes', () => {
  it('reads UTC when the zone is null or unknown', () => {
    const at = new Date('2026-06-01T23:30:00Z')
    expect(localMinutes(at, null)).toBe(m('23:30'))
    expect(localMinutes(at, undefined)).toBe(m('23:30'))
    expect(localMinutes(at, 'Not/AZone')).toBe(m('23:30'))
  })

  it('reads the wall clock in the saved zone, including half-hour offsets', () => {
    expect(localMinutes(new Date('2026-06-01T16:30:00Z'), 'Asia/Kolkata')).toBe(m('22:00'))
    expect(localMinutes(new Date('2026-01-15T03:00:00Z'), 'America/Toronto')).toBe(m('22:00'))
    expect(localMinutes(new Date('2026-07-15T02:00:00Z'), 'America/Toronto')).toBe(m('22:00'))
  })

  it('midnight reads as 0, never 24', () => {
    expect(localMinutes(new Date('2026-06-01T00:00:00Z'), 'UTC')).toBe(0)
    expect(localMinutes(new Date('2026-01-15T05:00:00Z'), 'America/Toronto')).toBe(0)
  })
})

describe('isInQuietHours', () => {
  it('is off unless enabled (the default is off)', () => {
    const night = new Date('2026-06-01T23:30:00Z')
    expect(DEFAULT_QUIET_HOURS.enabled).toBe(false)
    expect(isInQuietHours(night, DEFAULT_QUIET_HOURS)).toBe(false)
    expect(isInQuietHours(night, { ...DEFAULT_QUIET_HOURS, enabled: true })).toBe(true)
    expect(isInQuietHours(night, null)).toBe(false)
    expect(isInQuietHours(night, undefined)).toBe(false)
  })

  it('uses the saved zone, not the server clock', () => {
    // 23:30 UTC is 19:30 in Toronto (summer): not quiet there, quiet in UTC.
    const at = new Date('2026-06-01T23:30:00Z')
    expect(isInQuietHours(at, quiet({ timeZone: 'America/Toronto' }))).toBe(false)
    expect(isInQuietHours(at, quiet({ timeZone: null }))).toBe(true)
  })

  describe('daylight-saving nights in America/Toronto (2026)', () => {
    const tz = 'America/Toronto'

    it('spring forward (8 March, 02:00 -> 03:00): an overnight window still ends at 07:00 local', () => {
      // Before the change 07:00 local is 12:00 UTC; after it, 11:00 UTC.
      expect(isInQuietHours(new Date('2026-03-08T06:59:00Z'), quiet({ timeZone: tz }))).toBe(true) // 01:59 EST
      expect(isInQuietHours(new Date('2026-03-08T07:00:00Z'), quiet({ timeZone: tz }))).toBe(true) // 03:00 EDT
      expect(isInQuietHours(new Date('2026-03-08T10:59:00Z'), quiet({ timeZone: tz }))).toBe(true) // 06:59 EDT
      expect(isInQuietHours(new Date('2026-03-08T11:00:00Z'), quiet({ timeZone: tz }))).toBe(false) // 07:00 EDT
    })

    it('spring forward: a window inside the skipped hour never matches that night', () => {
      const skipped = quiet({ start: '02:00', end: '02:30', timeZone: tz })
      expect(isInQuietHours(new Date('2026-03-08T06:59:00Z'), skipped)).toBe(false) // 01:59 EST
      expect(isInQuietHours(new Date('2026-03-08T07:00:00Z'), skipped)).toBe(false) // 03:00 EDT
      // ...but does on an ordinary night.
      expect(isInQuietHours(new Date('2026-03-09T06:15:00Z'), skipped)).toBe(true) // 02:15 EDT
    })

    it('fall back (1 November, 02:00 -> 01:00): the repeated hour is quiet both times', () => {
      const repeated = quiet({ start: '01:00', end: '02:00', timeZone: tz })
      expect(isInQuietHours(new Date('2026-11-01T05:30:00Z'), repeated)).toBe(true) // 01:30 EDT
      expect(isInQuietHours(new Date('2026-11-01T06:30:00Z'), repeated)).toBe(true) // 01:30 EST
      expect(isInQuietHours(new Date('2026-11-01T07:00:00Z'), repeated)).toBe(false) // 02:00 EST
    })

    it('fall back: an overnight window ends at 07:00 local, now 12:00 UTC', () => {
      expect(isInQuietHours(new Date('2026-11-01T11:30:00Z'), quiet({ timeZone: tz }))).toBe(true) // 06:30 EST
      expect(isInQuietHours(new Date('2026-11-01T12:00:00Z'), quiet({ timeZone: tz }))).toBe(false) // 07:00 EST
    })
  })
})

describe('row mapping and validation', () => {
  it('a row without the columns (or null) reads as the defaults', () => {
    expect(quietHoursFromRow(null)).toEqual(DEFAULT_QUIET_HOURS)
    expect(quietHoursFromRow({})).toEqual(DEFAULT_QUIET_HOURS)
  })

  it('only an explicit true turns it on; bad stored values fall back', () => {
    expect(
      quietHoursFromRow({
        quiet_hours_enabled: true,
        quiet_hours_start: '21:30',
        quiet_hours_end: '06:15',
        quiet_hours_time_zone: 'Europe/London',
      })
    ).toEqual({ enabled: true, start: '21:30', end: '06:15', timeZone: 'Europe/London' })
    expect(
      quietHoursFromRow({
        quiet_hours_enabled: null,
        quiet_hours_start: '25:00',
        quiet_hours_end: '',
        quiet_hours_time_zone: 'Mars/Olympus',
      })
    ).toEqual(DEFAULT_QUIET_HOURS)
  })

  it('round-trips through the columns', () => {
    const q = quiet({ timeZone: 'America/Vancouver' })
    expect(quietHoursFromRow(quietHoursToColumns(q))).toEqual(q)
  })

  it('isValidTimeZone accepts IANA zones only', () => {
    expect(isValidTimeZone('America/Toronto')).toBe(true)
    expect(isValidTimeZone('UTC')).toBe(true)
    expect(isValidTimeZone('')).toBe(false)
    expect(isValidTimeZone('Mars/Olympus')).toBe(false)
    expect(isValidTimeZone(42)).toBe(false)
    expect(isValidTimeZone('A'.repeat(65))).toBe(false)
  })

  it('quietHoursProblem explains a form that cannot be saved', () => {
    expect(quietHoursProblem('22:00', '07:00')).toBeNull()
    expect(quietHoursProblem('', '07:00')).toMatch(/both a start and an end/)
    expect(quietHoursProblem('22:00', '22:00')).toMatch(/must be different/)
  })
})
