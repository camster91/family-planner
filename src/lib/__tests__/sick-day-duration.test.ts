import { sickDayDaysSince, sickDayDuration } from '../sick-day-duration'
import { sickDayDurationEnglish, sickDayDurationSpanish } from '@/i18n/sick-day-duration'

describe('sick day duration', () => {
  const now = new Date(2026, 10, 19, 9, 30)

  it('is never negative when the start is a little in the future (clock behind)', () => {
    const fewMinutesAhead = new Date(now.getTime() + 5 * 60 * 1000)
    expect(sickDayDaysSince(fewMinutesAhead, now)).toBe(0)
    expect(sickDayDuration(fewMinutesAhead, now)).toEqual({ key: 'startedToday', count: 0 })
    const daysAhead = new Date(now.getTime() + 3 * 86_400_000)
    expect(sickDayDaysSince(daysAhead, now)).toBe(0)
  })

  it('says "started today" for a sickness started minutes ago', () => {
    const minutesAgo = new Date(now.getTime() - 10 * 60 * 1000)
    expect(sickDayDuration(minutesAgo, now).key).toBe('startedToday')
  })

  it('counts calendar days, not 24-hour blocks', () => {
    expect(sickDayDuration(new Date(2026, 10, 18, 23, 50), now)).toEqual({ key: 'startedYesterday', count: 1 })
    expect(sickDayDuration(new Date(2026, 10, 16, 8, 0), now)).toEqual({ key: 'startedDaysAgo', count: 3 })
  })

  it('treats an unreadable start as today', () => {
    expect(sickDayDaysSince('not a date', now)).toBe(0)
  })

  it('has matching English and Spanish copy', () => {
    expect(Object.keys(sickDayDurationSpanish).sort()).toEqual(Object.keys(sickDayDurationEnglish).sort())
    expect(sickDayDurationSpanish.startedDaysAgo).toContain('{count}')
  })
})
