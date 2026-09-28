/**
 * @jest-environment jsdom
 */
// FridgeCal-style hub (#262): weather tile, member colours, chore approval
// state and the "Use soon" slot (#263) on the Today board.
import * as React from 'react'
import { act, render, screen, within } from '@testing-library/react'
import TodayBoard, { boardGridClass } from '../TodayBoard'
import { memberColors, memberDisplayNames, shortWeekday, weatherView } from '../board-model'
import { resolveMemberColors, MEMBER_COLOR_KEYS } from '@/lib/member-colors'
import type { TodayBoardData } from '@/app/dashboard/today/today-board-data'
import type { BoardWeather } from '@/lib/weather/board-weather'

jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: jest.fn() }) }))

// Local noon on Monday 5 January 2026 in whatever zone the test runs in.
const NOW = new Date(2026, 0, 5, 12, 0, 0)
const iso = (h: number) => new Date(2026, 0, 5, h, 0, 0).toISOString()

const WEATHER: BoardWeather = {
  label: 'Toronto, Ontario, Canada',
  unit: 'C',
  current: { temperature: -3, summary: 'Light snow', icon: 'snow', isDay: true },
  days: [
    { day: '2026-01-05', high: -1, low: -9, summary: 'Light snow', icon: 'snow', precipitationChance: 80 },
    { day: '2026-01-06', high: 3, low: -4, summary: 'Cloudy', icon: 'cloudy', precipitationChance: 10 },
    { day: '2026-01-07', high: 4, low: -2, summary: 'Clear', icon: 'clear', precipitationChance: 0 },
    { day: '2026-01-08', high: 5, low: 1, summary: 'Rain', icon: 'rain', precipitationChance: 70 },
  ],
  fetchedAt: '2026-01-05T16:00:00.000Z',
}

function data(overrides: Partial<TodayBoardData> = {}): TodayBoardData {
  return {
    generatedAt: NOW.toISOString(),
    members: [
      { id: 'p', name: 'Avery Parent', color: 'purple' },
      { id: 'c', name: 'Casey Child', color: 'green' },
    ],
    events: [
      { id: 'e1', title: 'Dentist', start: iso(14), end: iso(15), isTask: false, source: null, addedById: 'p' },
      {
        id: 'e2',
        title: 'Early dismissal',
        start: iso(15),
        end: iso(16),
        isTask: false,
        source: { name: 'School', color: '#0079A8' },
        addedById: null,
      },
    ],
    chores: [
      { id: 'k1', title: 'Tidy room', dueDay: '2026-01-05', status: 'pending', assigneeId: 'c' },
      { id: 'k2', title: 'Feed cat', dueDay: '2026-01-05', status: 'completed', assigneeId: 'c' },
      { id: 'k3', title: 'Dishes', dueDay: '2026-01-05', status: 'verified', assigneeId: 'p' },
    ],
    dinners: [],
    shopping: { items: [], total: 0 },
    links: { calendar: null, chores: null, meals: null, lists: null, features: null },
    weather: null,
    ...overrides,
  }
}

async function renderBoard(props: Partial<React.ComponentProps<typeof TodayBoard>> = {}) {
  jest.useFakeTimers({ now: NOW })
  const utils = render(<TodayBoard data={data()} fridgeMode {...props} />)
  await act(async () => {
    jest.advanceTimersByTime(0)
  })
  return utils
}

afterEach(() => {
  jest.useRealTimers()
})

describe('member colours (#262)', () => {
  it('resolves palette keys deterministically and cycles past the palette size', () => {
    const many = Array.from({ length: MEMBER_COLOR_KEYS.length + 2 }, (_, i) => ({ id: `m${i}`, board_color: null }))
    const out = [...resolveMemberColors(many).values()]
    expect(out.slice(0, MEMBER_COLOR_KEYS.length)).toEqual([...MEMBER_COLOR_KEYS])
    expect(out.slice(MEMBER_COLOR_KEYS.length)).toEqual(['indigo', 'sky'])
  })

  it('falls back to palette order for members without a colour (older servers)', () => {
    const map = memberColors([
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B', color: 'red' },
    ])
    expect(map.get('a')).toBe('indigo')
    expect(map.get('b')).toBe('red')
  })

  it('uses full names only when first names collide', () => {
    const names = memberDisplayNames([
      { id: 'a', name: 'Sam One' },
      { id: 'b', name: 'Sam Two' },
      { id: 'c', name: 'Riley Three' },
    ])
    expect([...names.values()]).toEqual(['Sam One', 'Sam Two', 'Riley'])
  })

  it('labels who added an event by name, not colour alone, and never on imported events', async () => {
    await renderBoard()
    const events = screen.getAllByTestId('today-event')
    const label = within(events[0]).getByTestId('event-member')
    expect(label.textContent).toBe('Added by Avery')
    expect(label.querySelector('[data-member-color="purple"]')).not.toBeNull()
    expect(within(events[1]).queryByTestId('event-member')).toBeNull()
  })

  it('shows each person with their colour next to their name, plus chore approval state as text', async () => {
    await renderBoard()
    const people = screen.getAllByTestId('chore-person')
    expect(people.map((p) => p.querySelector('h3')!.textContent)).toEqual(['Avery', 'Casey'])
    expect(people[0].querySelector('[data-member-color="purple"]')).not.toBeNull()
    expect(people[1].querySelector('[data-member-color="green"]')).not.toBeNull()
    expect(within(people[0]).getByTestId('chore-done').textContent).toBe('1 done')
    expect(within(people[1]).getByTestId('chore-done').textContent).toBe("1 done · 1 waiting for a parent's check")
    // No points, XP or streaks on the shared board, whatever the household setting.
    expect(screen.getByTestId('today-board').textContent).not.toMatch(/points|xp\b|streak/i)
  })
})

describe('weather tile (#262)', () => {
  it('is absent when the DTO has no weather (opt-in off, unavailable, or an older server)', async () => {
    await renderBoard()
    expect(screen.queryByTestId('board-weather')).toBeNull()
    jest.useRealTimers()
    await renderBoard({ data: { ...data(), weather: undefined } })
    expect(screen.queryByTestId('board-weather')).toBeNull()
  })

  it('shows temperature, summary, high/low and chance of precipitation as text', async () => {
    await renderBoard({ data: data({ weather: WEATHER }) })
    const tile = screen.getByTestId('board-weather')
    expect(screen.getByRole('region', { name: 'Weather in Toronto, Ontario, Canada' })).toBe(tile)
    expect(within(tile).getByTestId('weather-now').textContent).toBe('-3°C')
    expect(tile.textContent).toContain('Light snow')
    expect(tile.textContent).toContain('80% chance of rain or snow')
    expect(tile.textContent).toContain('Toronto, Ontario, Canada')
    // Next three days for the wide hub (hidden below 2xl by CSS only).
    const days = within(tile).getAllByTestId('weather-day')
    expect(days.map((d) => d.textContent)).toEqual([
      'TueCloudy, high 3°, low / -4°',
      'WedClear, high 4°, low / -2°',
      'ThuRain, high 5°, low / 1°',
    ])
  })

  it('picks the viewer-local day, whatever the first forecast day is', () => {
    const v = weatherView({ ...WEATHER, days: WEATHER.days.slice(0) }, new Date(2026, 0, 6, 9))
    expect(v?.today?.day).toBe('2026-01-06')
    expect(v?.next.map((d) => d.day)).toEqual(['2026-01-07', '2026-01-08'])
    // Forecast entirely in the past: last known day, nothing after.
    const past = weatherView(WEATHER, new Date(2026, 0, 20, 9))
    expect(past?.today?.day).toBe('2026-01-08')
    expect(past?.next).toEqual([])
    expect(weatherView(null, NOW)).toBeNull()
    expect(shortWeekday('2026-01-05')).toBe('Mon')
  })
})

describe('"Use soon" slot (#263 extension point)', () => {
  it('renders nothing extra by default and keeps the four-column hub', async () => {
    await renderBoard()
    expect(screen.queryByTestId('board-slot-use-soon')).toBeNull()
    expect(boardGridClass(true, false)).toContain('"today_dinner_chores_coming"_"today_groceries_chores_coming"]')
    expect(boardGridClass(true, false)).not.toContain('usesoon')
  })

  it('gives a provided tile its own grid area in every layout', async () => {
    await renderBoard({ useSoon: <section aria-label="Use soon">Milk expires tomorrow</section> })
    const slot = screen.getByTestId('board-slot-use-soon')
    expect(slot.textContent).toBe('Milk expires tomorrow')
    expect(slot.className).toContain('md:[grid-area:usesoon]')
    const grid = boardGridClass(true, true)
    expect(grid).toContain('"today_usesoon_chores_coming"')
    expect(grid).toContain('"usesoon_usesoon"')
  })
})
