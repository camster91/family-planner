/**
 * @jest-environment jsdom
 */
// Visible sync and the calm display (#271) on the Today board: version
// polling, "Updated … ago" in words, stale notice, the polite announcement,
// idle → calm frame (fridge mode only), night dimming, reduced motion, and a
// tap or key that returns to the board without activating what is underneath.
import * as React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import TodayBoard from '../TodayBoard'
import type { TodayBoardData } from '@/app/dashboard/today/today-board-data'
import type { BoardWeather } from '@/lib/weather/board-weather'

const refresh = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

// Local noon on Monday 5 January 2026 in whatever zone the test runs in.
const NOW = new Date(2026, 0, 5, 12, 0, 0)
const at = (h: number, m = 0) => new Date(2026, 0, 5, h, m, 0).toISOString()
const MIN = 60 * 1000

const WEATHER: BoardWeather = {
  label: 'Toronto, Ontario, Canada',
  unit: 'C',
  current: { temperature: -3, summary: 'Light snow', icon: 'snow', isDay: true },
  days: [{ day: '2026-01-05', high: -1, low: -9, summary: 'Light snow', icon: 'snow', precipitationChance: 80 }],
  fetchedAt: '2026-01-05T16:00:00.000Z',
}

function data(overrides: Partial<TodayBoardData> = {}): TodayBoardData {
  return {
    generatedAt: NOW.toISOString(),
    version: 'v1',
    members: [{ id: 'p', name: 'Avery Parent', color: 'purple' }],
    events: [
      { id: 'e0', title: 'Lunch', start: at(11), end: at(13), isTask: false, source: null, addedById: 'p' },
      { id: 'e1', title: 'Dentist', start: at(14), end: at(15), isTask: false, source: null, addedById: 'p' },
    ],
    chores: [],
    dinners: [{ id: 'd1', day: '2026-01-05', recipeName: 'Veggie tacos', cookName: null }],
    shopping: { items: [], total: 0 },
    links: { calendar: null, chores: null, meals: null, lists: null, features: null },
    weather: null,
    display: { idleMinutes: 5, night: null },
    ...overrides,
  }
}

async function flush(ms = 0) {
  await act(async () => {
    jest.advanceTimersByTime(ms)
  })
  // Let resolved version checks settle.
  await act(async () => {
    await Promise.resolve()
  })
}

async function renderBoard(props: Partial<React.ComponentProps<typeof TodayBoard>> = {}) {
  const utils = render(<TodayBoard data={data()} fridgeMode checkVersion={async () => 'v1'} {...props} />)
  await flush()
  return utils
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW })
  refresh.mockReset()
})
afterEach(() => {
  jest.useRealTimers()
})

describe('visible sync', () => {
  it('says "Updated just now" and keeps it true while checks confirm the version', async () => {
    const checkVersion = jest.fn(async () => 'v1')
    const onRefresh = jest.fn()
    await renderBoard({ checkVersion, onRefresh })
    expect(screen.getByTestId('board-updated').textContent).toContain('Updated just now')
    await flush(3 * MIN)
    expect(checkVersion).toHaveBeenCalled()
    expect(onRefresh).not.toHaveBeenCalled()
    expect(screen.getByTestId('board-updated').textContent).toContain('Updated just now')
    expect(screen.queryByTestId('sync-notice')).toBeNull()
  })

  it('re-fetches the board only when the version changes, and announces new data politely', async () => {
    const onRefresh = jest.fn()
    const { rerender } = await renderBoard({ checkVersion: async () => 'v2', onRefresh })
    const live = screen.getByTestId('board-sync-announce')
    expect(live.getAttribute('aria-live')).toBe('polite')
    expect(live.textContent).toBe('')
    await flush(25 * 1000)
    expect(onRefresh).toHaveBeenCalledTimes(1)
    rerender(
      <TodayBoard
        data={data({ version: 'v2', generatedAt: new Date(NOW.getTime() + 26_000).toISOString() })}
        fridgeMode
        checkVersion={async () => 'v2'}
        onRefresh={onRefresh}
      />
    )
    await flush()
    expect(screen.getByTestId('board-sync-announce').textContent).toContain('The board has been updated.')
    // The ticking "Updated" line is not a live region.
    expect(screen.getByTestId('board-updated').hasAttribute('aria-live')).toBe(false)
  })

  it('the person board uses router.refresh when no onRefresh is given', async () => {
    await renderBoard({ checkVersion: async () => 'v2', fridgeMode: false })
    await flush(25 * 1000)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('says in words when the server cannot be reached', async () => {
    await renderBoard({ checkVersion: async () => Promise.reject(new Error('down')), fridgeMode: false })
    await flush(3 * MIN)
    expect(screen.getByTestId('board-updated').textContent).toContain('Updated 3 min ago')
    expect(screen.getByTestId('sync-notice').textContent).toContain(
      "Can't reach Herewoven right now. Showing what was here 3 min ago."
    )
  })

  it('says in words when offline, and does not poll', async () => {
    const checkVersion = jest.fn(async () => 'v1')
    const spy = jest.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    try {
      await renderBoard({ checkVersion, fridgeMode: false })
      await act(async () => {
        window.dispatchEvent(new Event('offline'))
      })
      await flush(MIN)
      expect(checkVersion).not.toHaveBeenCalled()
      // App mode: the app-wide banner says "You're offline"; the board adds only how old its data is.
      const notice = screen.getByTestId('sync-notice').textContent
      expect(notice).toBe('Showing what was here 1 min ago. The board refreshes when the connection returns.')
    } finally {
      spy.mockRestore()
    }
  })

  it('fridge mode hides the app banner, so its own notice still says it is offline', async () => {
    const spy = jest.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    try {
      await renderBoard({ checkVersion: jest.fn(async () => 'v1') })
      await act(async () => {
        window.dispatchEvent(new Event('offline'))
      })
      await flush(MIN)
      expect(screen.getByTestId('sync-notice').textContent).toContain("You're offline. Showing what was here 1 min ago.")
    } finally {
      spy.mockRestore()
    }
  })
})

describe('calm display', () => {
  it('fades to the calm frame after the idle time: clock, date, weather, next event, tonight\'s dinner', async () => {
    await renderBoard({ data: data({ weather: WEATHER }) })
    await flush(4 * MIN)
    expect(screen.queryByTestId('ambient-cover')).toBeNull()
    await flush(MIN + 15 * 1000)
    const cover = screen.getByTestId('ambient-cover')
    expect(cover.getAttribute('data-ambient')).toBe('true')
    expect(cover.getAttribute('data-dim')).toBe('false')
    expect(screen.getByTestId('ambient-clock').textContent).toContain('12:05 PM')
    expect(screen.getByTestId('ambient-date').textContent).toContain('Monday, January 5')
    expect(screen.getByTestId('ambient-weather').textContent).toContain('-3°C')
    expect(screen.getByTestId('ambient-next').textContent).toContain('Next · 2:00 PM')
    expect(screen.getByTestId('ambient-next').textContent).toContain('Dentist')
    expect(screen.getByTestId('ambient-dinner').textContent).toContain('Veggie tacos')
    // No photos unless chosen.
    expect(screen.queryByTestId('ambient-photo')).toBeNull()
    // The board underneath is out of the focus order and accessibility tree.
    expect(screen.getByTestId('today-board').hasAttribute('inert')).toBe(true)
  })

  it('shows no weather when the household has not opted in', async () => {
    await renderBoard()
    await flush(6 * MIN)
    expect(screen.getByTestId('ambient-cover')).toBeTruthy()
    expect(screen.queryByTestId('ambient-weather')).toBeNull()
  })

  it('a tap returns to the board without activating what is underneath', async () => {
    const pressed = jest.fn()
    await renderBoard({ actions: <button onClick={pressed}>Parent</button> })
    await flush(6 * MIN)
    const cover = screen.getByTestId('ambient-cover')
    fireEvent.pointerDown(cover)
    fireEvent.click(cover)
    await flush()
    expect(screen.queryByTestId('ambient-cover')).toBeNull()
    expect(pressed).not.toHaveBeenCalled()
    expect(screen.getByTestId('today-board').hasAttribute('inert')).toBe(false)
  })

  it('a key returns to the board and is swallowed', async () => {
    const pressed = jest.fn()
    await renderBoard({ actions: <button onClick={pressed}>Parent</button> })
    await flush(6 * MIN)
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    await act(async () => {
      document.activeElement!.dispatchEvent(event)
    })
    expect(event.defaultPrevented).toBe(true)
    await flush()
    expect(screen.queryByTestId('ambient-cover')).toBeNull()
    expect(pressed).not.toHaveBeenCalled()
  })

  it('a touch on the board restarts the idle time', async () => {
    await renderBoard()
    await flush(4 * MIN)
    fireEvent.pointerDown(screen.getByTestId('today-board'))
    await flush(2 * MIN)
    expect(screen.queryByTestId('ambient-cover')).toBeNull()
    await flush(4 * MIN)
    expect(screen.getByTestId('ambient-cover')).toBeTruthy()
  })

  it('never fades outside fridge mode, or when the household turned it off', async () => {
    const { unmount } = await renderBoard({ fridgeMode: false })
    await flush(30 * MIN)
    expect(screen.queryByTestId('ambient-cover')).toBeNull()
    unmount()
    await renderBoard({ data: data({ display: { idleMinutes: 0, night: null } }) })
    await flush(30 * MIN)
    expect(screen.queryByTestId('ambient-cover')).toBeNull()
  })

  it('fades only when motion is welcome (motion-safe transition, instant under reduced motion)', async () => {
    await renderBoard()
    await flush(6 * MIN)
    const cls = screen.getByTestId('ambient-cover').className
    expect(cls).toContain('motion-safe:transition-opacity')
    expect(cls).not.toMatch(/(^|\s)transition-opacity/)
  })

  it('dims during night hours, over the calm frame', async () => {
    await renderBoard({ data: data({ display: { idleMinutes: 5, night: { start: '11:00', end: '13:00' } } }) })
    await flush(6 * MIN)
    const cover = screen.getByTestId('ambient-cover')
    expect(cover.getAttribute('data-dim')).toBe('true')
    expect(screen.getByTestId('night-dim')).toBeTruthy()
  })

  it('shows chosen household photos on a signed-in board', async () => {
    await renderBoard({
      data: data({
        display: { idleMinutes: 5, night: null, photos: [{ id: 'up-a', url: '/api/files/chores/aaaaaaaaaaaaaaa1.jpg' }] },
      }),
    })
    await flush(6 * MIN)
    expect(screen.getByTestId('ambient-photo').getAttribute('src')).toBe('/api/files/chores/aaaaaaaaaaaaaaa1.jpg')
  })
})
