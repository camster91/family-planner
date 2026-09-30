// Calm display and night hours (#271): idle, ambient and night rules.
import {
  AMBIENT_IDLE_CHOICES,
  DEFAULT_AMBIENT_IDLE_MINUTES,
  NIGHT_IDLE_FALLBACK_MS,
  ambientState,
  clockMinutes,
  formatClockTime,
  idleMinutesFrom,
  isClockTime,
  isNightTime,
  nightHoursFrom,
  type BoardDisplay,
} from '../ambient'

const MIN = 60 * 1000
/** Local wall-clock time on 5 January 2026, in whatever zone the test runs in. */
const at = (h: number, m = 0) => new Date(2026, 0, 5, h, m, 0)

describe('clock times', () => {
  it.each(['00:00', '06:30', '21:30', '23:59'])('accepts %s', (v) => expect(isClockTime(v)).toBe(true))
  it.each(['24:00', '7:30', '21:60', '', 'noon', null, 930])('rejects %p', (v) => expect(isClockTime(v)).toBe(false))

  it('converts to minutes and to words', () => {
    expect(clockMinutes('21:30')).toBe(21 * 60 + 30)
    expect(clockMinutes('bad')).toBeNull()
    expect(formatClockTime('21:30')).toBe('9:30 PM')
    expect(formatClockTime('00:05')).toBe('12:05 AM')
    expect(formatClockTime('12:00')).toBe('12:00 PM')
  })
})

describe('stored settings', () => {
  it('night hours need two valid, different times, else off', () => {
    expect(nightHoursFrom('21:30', '06:30')).toEqual({ start: '21:30', end: '06:30' })
    expect(nightHoursFrom(null, null)).toBeNull()
    expect(nightHoursFrom('21:30', null)).toBeNull()
    expect(nightHoursFrom('21:30', '21:30')).toBeNull()
    expect(nightHoursFrom('25:00', '06:00')).toBeNull()
  })

  it('idle minutes fall back to the default outside the choices', () => {
    expect(idleMinutesFrom(10)).toBe(10)
    expect(idleMinutesFrom(0)).toBe(0)
    expect(idleMinutesFrom(7)).toBe(DEFAULT_AMBIENT_IDLE_MINUTES)
    expect(idleMinutesFrom(null)).toBe(DEFAULT_AMBIENT_IDLE_MINUTES)
    expect(AMBIENT_IDLE_CHOICES).toContain(DEFAULT_AMBIENT_IDLE_MINUTES)
  })
})

describe('isNightTime', () => {
  const overnight = { start: '21:30', end: '06:30' }
  it.each<[number, number, boolean]>([
    [21, 29, false],
    [21, 30, true], // start inclusive
    [23, 59, true],
    [0, 0, true],
    [6, 29, true],
    [6, 30, false], // end exclusive
    [12, 0, false],
  ])('overnight window at %i:%i -> %s', (h, m, expected) => {
    expect(isNightTime(at(h, m), overnight)).toBe(expected)
  })

  it('handles a window inside one day', () => {
    const nap = { start: '13:00', end: '15:00' }
    expect(isNightTime(at(12, 59), nap)).toBe(false)
    expect(isNightTime(at(13, 0), nap)).toBe(true)
    expect(isNightTime(at(15, 0), nap)).toBe(false)
  })

  it('is off without night hours', () => {
    expect(isNightTime(at(23), null)).toBe(false)
    expect(isNightTime(at(23), { start: 'x', end: 'y' })).toBe(false)
  })
})

describe('ambientState', () => {
  const day: BoardDisplay = { idleMinutes: 5, night: null }
  const nightly: BoardDisplay = { idleMinutes: 5, night: { start: '21:30', end: '06:30' } }

  it('shows the board until the idle timeout, then the calm frame', () => {
    expect(ambientState({ idleMs: 5 * MIN - 1, now: at(12), display: day })).toEqual({ ambient: false, dim: false })
    expect(ambientState({ idleMs: 5 * MIN, now: at(12), display: day })).toEqual({ ambient: true, dim: false })
  })

  it('never fades with the calm frame off', () => {
    expect(ambientState({ idleMs: 10 * 60 * MIN, now: at(12), display: { idleMinutes: 0, night: null } })).toEqual({
      ambient: false,
      dim: false,
    })
  })

  it('dims during night hours once idle, not while someone is using it', () => {
    expect(ambientState({ idleMs: MIN, now: at(23), display: nightly })).toEqual({ ambient: false, dim: false })
    expect(ambientState({ idleMs: 5 * MIN, now: at(23), display: nightly })).toEqual({ ambient: true, dim: true })
    // Outside night hours: calm frame, no dimming.
    expect(ambientState({ idleMs: 5 * MIN, now: at(8), display: nightly })).toEqual({ ambient: true, dim: false })
  })

  it('still dims at night with the calm frame off, after the short fallback', () => {
    const display: BoardDisplay = { idleMinutes: 0, night: nightly.night }
    expect(ambientState({ idleMs: NIGHT_IDLE_FALLBACK_MS - 1, now: at(23), display })).toEqual({
      ambient: false,
      dim: false,
    })
    expect(ambientState({ idleMs: NIGHT_IDLE_FALLBACK_MS, now: at(23), display })).toEqual({ ambient: false, dim: true })
  })
})
