// Calm display corner (#271): the next event (title and time only) and
// tonight's dinner title.
import { dinnerTitle, nextEvent } from '../board-model'
import type { BoardEvent } from '@/app/dashboard/today/today-board-data'

const NOW = new Date(2026, 0, 5, 12, 0, 0) // Monday, local noon
const iso = (d: number, h: number, m = 0) => new Date(2026, 0, 5 + d, h, m, 0).toISOString()
const ev = (id: string, title: string, start: string): BoardEvent => ({
  id,
  title,
  start,
  end: start,
  isTask: false,
  source: { name: 'School', color: null },
  addedById: 'p',
})

describe('nextEvent', () => {
  it('is the soonest event that has not started, with its time in words', () => {
    const events = [ev('b', 'Swim', iso(0, 17, 30)), ev('a', 'Lunch', iso(0, 11)), ev('c', 'Dentist', iso(0, 14))]
    expect(nextEvent(events, NOW)).toEqual({ title: 'Dentist', when: '2:00 PM' })
  })

  it('names tomorrow and later days', () => {
    expect(nextEvent([ev('a', 'Library', iso(1, 9))], NOW)).toEqual({ title: 'Library', when: 'Tomorrow 9:00 AM' })
    expect(nextEvent([ev('a', 'Recital', iso(2, 18))], NOW)).toEqual({ title: 'Recital', when: 'Wed 6:00 PM' })
  })

  it('carries no source, member or other fields', () => {
    expect(Object.keys(nextEvent([ev('a', 'Library', iso(1, 9))], NOW)!).sort()).toEqual(['title', 'when'])
  })

  it('is null with nothing ahead', () => {
    expect(nextEvent([ev('a', 'Lunch', iso(0, 11))], NOW)).toBeNull()
    expect(nextEvent([], NOW)).toBeNull()
  })
})

describe('dinnerTitle', () => {
  it('prefers the meal name, then the recipe title, then a neutral line', () => {
    expect(dinnerTitle({ id: 'd', day: '2026-01-05', recipeName: 'Tacos', cookName: null, recipeTitle: 'Beef tacos' })).toBe(
      'Tacos'
    )
    expect(dinnerTitle({ id: 'd', day: '2026-01-05', recipeName: null, cookName: null, recipeTitle: 'Beef tacos' })).toBe(
      'Beef tacos'
    )
    expect(dinnerTitle({ id: 'd', day: '2026-01-05', recipeName: '  ', cookName: null })).toBe('Dinner is planned')
    expect(dinnerTitle(null)).toBeNull()
  })
})
