// All-day events: the shared rules every reader and writer uses.
import { allDayCovers, allDayDays, allDayLength, dayAfter, validAllDayRange } from '@/lib/all-day'
import { planFollowingEdit, seriesOccurrenceEnd, wallTimeIn, isFollowingRefusal } from '@/lib/event-series'
import { reminderText } from '@/lib/event-reminders'
import { eventsOnDay } from '@/lib/morning-summary'
import { createEventSchema, updateEventSchema } from '@/lib/validations'
import { commitEventSchema, checkCommitRanges } from '@/lib/event-import-commit'
import { overlappingEvents } from '@/lib/calendar-planning/view'
import { zonedWallTimeToUtc } from '@/lib/calendar-import/timezone'

const at = (zone: string, y: number, m: number, d: number, hour = 0, minute = 0) =>
  zonedWallTimeToUtc({ year: y, month: m, day: d, hour, minute, second: 0 }, zone).getTime()

describe('allDayDays', () => {
  it.each([
    ['America/Toronto'], ['America/Vancouver'], ['Pacific/Honolulu'], ['UTC'], ['Europe/Madrid'],
    ['Asia/Kolkata'], ['Asia/Tokyo'], ['Australia/Sydney'], ['Pacific/Auckland'], ['Pacific/Chatham'],
  ])('reads the calendar day back from a local midnight in %s', (zone) => {
    for (const [m, d] of [[1, 15], [7, 15], [12, 31]]) {
      const key = `2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      // Made in the app: 00:00 to 23:59 of the day.
      expect(allDayDays(at(zone, 2026, m, d), at(zone, 2026, m, d, 23, 59))).toEqual({ first: key, last: key })
      // Imported DATE values: midnight to the next midnight.
      expect(allDayDays(at(zone, 2026, m, d), at(zone, 2026, m, d + 1))).toEqual({ first: key, last: key })
    }
  })

  it('covers every day of a longer event, both end shapes', () => {
    const zone = 'America/Toronto'
    expect(allDayDays(at(zone, 2026, 7, 3), at(zone, 2026, 7, 5, 23, 59))).toEqual({ first: '2026-07-03', last: '2026-07-05' })
    expect(allDayDays(at(zone, 2026, 7, 3), at(zone, 2026, 7, 6))).toEqual({ first: '2026-07-03', last: '2026-07-05' })
  })

  it('a clock change inside the event does not add or lose a day', () => {
    const zone = 'America/Toronto'
    // Spring forward (March 8, 2026) and fall back (November 1, 2026).
    expect(allDayDays(at(zone, 2026, 3, 7), at(zone, 2026, 3, 9, 23, 59))).toEqual({ first: '2026-03-07', last: '2026-03-09' })
    expect(allDayDays(at(zone, 2026, 3, 7), at(zone, 2026, 3, 10))).toEqual({ first: '2026-03-07', last: '2026-03-09' })
    expect(allDayDays(at(zone, 2026, 10, 31), at(zone, 2026, 11, 2, 23, 59))).toEqual({ first: '2026-10-31', last: '2026-11-02' })
    expect(allDayDays(at(zone, 2026, 10, 31), at(zone, 2026, 11, 3))).toEqual({ first: '2026-10-31', last: '2026-11-02' })
    expect(allDayDays(at(zone, 2026, 11, 1), at(zone, 2026, 11, 1, 23, 59))).toEqual({ first: '2026-11-01', last: '2026-11-01' })
  })

  it('accepts dates, ISO strings and numbers; a zero-length or broken end is one day', () => {
    const start = at('America/Toronto', 2026, 5, 4)
    expect(allDayDays(new Date(start), new Date(start))).toEqual({ first: '2026-05-04', last: '2026-05-04' })
    expect(allDayDays(new Date(start).toISOString(), 'nope')).toEqual({ first: '2026-05-04', last: '2026-05-04' })
    expect(allDayDays('nope', start)).toBeNull()
  })

  it('answers whether a day is covered, the next day and the length', () => {
    const event = { start: at('America/Toronto', 2026, 5, 4), end: at('America/Toronto', 2026, 5, 6, 23, 59) }
    expect(['2026-05-03', '2026-05-04', '2026-05-06', '2026-05-07'].map((day) => allDayCovers(event, day))).toEqual([false, true, true, false])
    expect(dayAfter('2026-12-31')).toBe('2027-01-01')
    expect(dayAfter('2028-02-28')).toBe('2028-02-29')
    expect(allDayLength({ first: '2026-05-04', last: '2026-05-06' })).toBe(3)
    expect(allDayLength({ first: '2026-05-04', last: '2026-05-04' })).toBe(1)
  })

  it('an all-day request must cover some time', () => {
    expect(validAllDayRange(1, 2)).toBe(true)
    expect(validAllDayRange(2, 2)).toBe(false)
    expect(validAllDayRange(Number.NaN, 2)).toBe(false)
  })
})

describe('contracts', () => {
  const base = { title: 'Field trip', start_time: '2026-03-03T05:00:00.000Z', end_time: '2026-03-04T04:59:00.000Z' }
  it('create accepts all_day and older clients that omit it keep working', () => {
    expect(createEventSchema.parse(base).all_day).toBeUndefined()
    expect(createEventSchema.parse({ ...base, all_day: true }).all_day).toBe(true)
    expect(createEventSchema.safeParse({ ...base, all_day: 'yes' }).success).toBe(false)
  })
  it('update: omitted leaves it alone, off is free, on names both ends of the day range', () => {
    expect(updateEventSchema.parse({ eventId: 'e', title: 'x' }).all_day).toBeUndefined()
    expect(updateEventSchema.safeParse({ eventId: 'e', all_day: false }).success).toBe(true)
    expect(updateEventSchema.safeParse({ eventId: 'e', all_day: true, start_time: base.start_time, end_time: base.end_time }).success).toBe(true)
    expect(updateEventSchema.safeParse({ eventId: 'e', all_day: true }).success).toBe(false)
    expect(updateEventSchema.safeParse({ eventId: 'e', all_day: true, start_time: base.start_time }).success).toBe(false)
    expect(updateEventSchema.safeParse({ eventId: 'e', all_day: true, start_time: base.start_time, end_time: base.start_time }).success).toBe(false)
  })
  it('reviewed imports carry all_day and refuse an empty all-day range', () => {
    expect(commitEventSchema.parse({ ...base, all_day: true }).all_day).toBe(true)
    expect(commitEventSchema.safeParse({ ...base, event_type: 'other' }).success).toBe(false)
    expect(checkCommitRanges({ events: [{ ...base, all_day: true }] })).toBeNull()
    expect(checkCommitRanges({ events: [{ title: 'x', start_time: base.start_time, all_day: true }] })).toMatch(/all-day/)
  })
})

describe('repeating all-day events', () => {
  const zone = 'America/Toronto'
  const DAY = 86_400_000
  it('every occurrence ends at 23:59 of its own local day, whatever the day length', () => {
    const series = { duration_ms: DAY - 60_000, all_day: true, time_zone: zone }
    for (const [m, d] of [[3, 7], [3, 8], [3, 9], [11, 1], [7, 1]]) {
      const start = at(zone, 2026, m, d)
      const end = wallTimeIn(seriesOccurrenceEnd(series, start), zone)
      expect([end.month, end.day, end.hour, end.minute]).toEqual([m, d, 23, 59])
    }
  })
  it('keeps the number of days of a longer all-day repeat', () => {
    const start = at(zone, 2026, 3, 7)
    const end = wallTimeIn(seriesOccurrenceEnd({ duration_ms: at(zone, 2026, 3, 9, 23, 59) - start, all_day: 1, time_zone: zone }, start), zone)
    expect([end.month, end.day, end.hour, end.minute]).toEqual([3, 9, 23, 59])
  })
  it('a timed repeat keeps its exact length', () => {
    expect(seriesOccurrenceEnd({ duration_ms: 3_600_000, all_day: false, time_zone: zone }, 1_000)).toBe(3_601_000)
    expect(seriesOccurrenceEnd({ duration_ms: 3_600_000 }, 1_000)).toBe(3_601_000)
  })
  it('"this and later" keeps what is stored unless the request says otherwise', () => {
    const event = { start: at(zone, 2026, 3, 7), end: at(zone, 2026, 3, 7, 23, 59), title: 'Recycling', description: null, location: null, event_type: 'other', occurrenceStart: at(zone, 2026, 3, 7) }
    const series = { every: 'week' as const, timeZone: zone, untilDay: null, anchorStart: at(zone, 2026, 2, 28) }
    const kept = planFollowingEdit({ event: { ...event, allDay: true }, series }, { title: 'Compost' })
    const off = planFollowingEdit({ event: { ...event, allDay: true }, series }, { all_day: false })
    const on = planFollowingEdit({ event, series }, { all_day: true })
    const plain = planFollowingEdit({ event, series }, {})
    expect([kept, off, on, plain].map((plan) => !isFollowingRefusal(plan) && plan.allDay)).toEqual([true, false, true, false])
  })
})

describe('readers', () => {
  const zone = 'America/Toronto'
  it('a reminder for an all-day event names the day and no clock time', () => {
    const now = at(zone, 2026, 3, 2, 15)
    const text = reminderText({ title: 'Field trip', start: at(zone, 2026, 3, 3), allDay: true }, zone, now)
    expect(text).toEqual({ title: 'Coming up: Field trip', message: 'Tomorrow, all day' })
    expect(reminderText({ title: 'Dentist', start: at(zone, 2026, 3, 3, 10), allDay: false }, zone, now).message).toBe('Tomorrow at 10:00 AM')
  })
  it('the morning summary says "all day" for a flagged event and keeps it on each of its days', () => {
    const trip = { title: 'Field trip', start: new Date(at(zone, 2026, 3, 3)), end: new Date(at(zone, 2026, 3, 4, 23, 59)), allDay: true }
    const same = { ...trip, title: 'Unflagged', allDay: false }
    expect(eventsOnDay([trip], '2026-03-03', zone)).toEqual([{ title: 'Field trip', when: 'all day' }])
    expect(eventsOnDay([trip], '2026-03-04', zone)).toEqual([{ title: 'Field trip', when: 'all day' }])
    expect(eventsOnDay([trip], '2026-03-05', zone)).toEqual([])
    // Without the flag the same instants read as a timed event that started at midnight.
    expect(eventsOnDay([same], '2026-03-04', zone)[0].when).toMatch(/^until /)
  })
  it('all-day events are never "at the same time" as anything', () => {
    const range = { start: '2026-03-03T00:00:00.000Z', end: '2026-03-05T00:00:00.000Z' }
    const birthday = { id: 'a', start_time: '2026-03-03T05:00:00.000Z', end_time: '2026-03-04T04:59:00.000Z', all_day: true }
    const trip = { id: 'b', start_time: '2026-03-03T05:00:00.000Z', end_time: '2026-03-04T04:59:00.000Z', all_day: true }
    const soccer = { id: 'c', start_time: '2026-03-03T20:00:00.000Z', end_time: '2026-03-03T21:00:00.000Z' }
    const piano = { id: 'd', start_time: '2026-03-03T20:30:00.000Z', end_time: '2026-03-03T21:30:00.000Z', all_day: false }
    expect(overlappingEvents([birthday, trip, soccer], range).total).toBe(0)
    const clash = overlappingEvents([birthday, trip, soccer, piano], range)
    expect(clash.total).toBe(1)
    expect([clash.pairs[0].first.id, clash.pairs[0].second.id]).toEqual(['c', 'd'])
    // The same events without the flag would all overlap.
    expect(overlappingEvents([{ ...birthday, all_day: false }, soccer], range).total).toBe(1)
  })
})
