import { buildMorningSummary, dayLabelOf, formatClock } from '../morning-summary'

it('formats an explicit en-GB display locale independently of Toronto timezone and date keys', () => {
  const input = {
    person: { id: 'kid', role: 'child' }, dayKey: '2026-10-03', timeZone: 'America/Toronto', displayLocale: 'en-GB',
    features: { chores: true, calendar: true, meals: true }, chores: [], dinners: [], toCheckCount: 10,
    events: [{ title: 'Library', start: new Date('2026-10-03T19:30:00Z'), end: new Date('2026-10-03T20:00:00Z') }],
  }
  const result = buildMorningSummary(input)!
  expect(result.dayLabel).toBe('Saturday 3 October')
  expect(result.events!.items).toEqual([{ title: 'Library', when: 'at 15:30' }])
  expect(result.dayKey).toBe('2026-10-03')
  expect(result.toCheck).toBeNull()
  expect(result.text).toBe('Today: Library at 15:30.')
  expect(input.events[0].start.toISOString()).toBe('2026-10-03T19:30:00.000Z')
})

it('retains existing email/account formatting when no persisted display locale exists', () => {
  expect(dayLabelOf('2026-10-03')).toBe('Saturday, October 3')
  expect(formatClock(new Date('2026-10-03T19:30:00Z'), 'America/Toronto')).toBe('3:30pm')
})
