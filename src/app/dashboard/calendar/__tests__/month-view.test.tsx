/**
 * @jest-environment jsdom
 */
// The calendar month is the viewer's local month (O-31): the server sends the
// UTC month plus a day each side and the page keeps only events in the local
// month. Previous/next links move by month; with no month in the URL the page
// moves to the local month; quick capture refreshes the list after a save.
// Instants are built in the runtime's local zone, so this holds in any TZ (a
// Toronto viewer's Oct 31 8:30 PM is stored as Nov 1 00:30Z).

import * as React from 'react'
import { render, screen } from '@testing-library/react'
import CalendarPageClient from '../CalendarPageClient'

const mockRefresh = jest.fn()
const mockReplace = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh, replace: mockReplace, push: jest.fn() }),
}))
jest.mock('@/components/capture/CaptureBox', () => ({
  CaptureBox: ({ onSaved }: { onSaved?: () => void }) => (
    <button type="button" onClick={onSaved}>
      fake capture save
    </button>
  ),
}))

function event(id: string, title: string, start: string) {
  return { id, title, start_time: start, end_time: start, event_type: 'other' }
}

beforeEach(() => {
  mockRefresh.mockClear()
  mockReplace.mockClear()
  jest.useRealTimers()
})

describe('calendar month view', () => {
  it('shows a local Oct 31 8:30 PM event in October, not November', () => {
    const events = [
      event('b', 'Late September thing', new Date(2026, 8, 30, 21, 0).toISOString()),
      event('c', 'Mid October', new Date(2026, 9, 15, 10, 0).toISOString()),
      event('a', 'Halloween party', new Date(2026, 9, 31, 20, 30).toISOString()),
      event('d', 'November first', new Date(2026, 10, 1, 0, 30).toISOString()),
    ]
    const { rerender } = render(<CalendarPageClient events={events} currentMonth={10} currentYear={2026} />)
    expect(screen.getByText('Halloween party')).toBeTruthy()
    expect(screen.getByText('Mid October')).toBeTruthy()
    expect(screen.queryByText('Late September thing')).toBeNull()
    expect(screen.queryByText('November first')).toBeNull()

    rerender(<CalendarPageClient events={events} currentMonth={11} currentYear={2026} />)
    expect(screen.queryByText('Halloween party')).toBeNull()
    expect(screen.getByText('November first')).toBeTruthy()
  })

  it('links to the previous and next month, rolling the year over', () => {
    render(<CalendarPageClient events={[]} currentMonth={1} currentYear={2026} />)
    const prev = screen.getByRole('link', { name: 'Previous month, December 2025' })
    const next = screen.getByRole('link', { name: 'Next month, February 2026' })
    expect(prev.getAttribute('href')).toBe('/dashboard/calendar?year=2025&month=12')
    expect(next.getAttribute('href')).toBe('/dashboard/calendar?year=2026&month=2')
    expect(prev.className).toContain('h-11')
    expect(prev.className).toContain('min-w-[44px]')
  })

  it('has no dead Day/Week/Month control', () => {
    render(<CalendarPageClient events={[]} currentMonth={1} currentYear={2026} />)
    for (const name of ['Day', 'Week', 'Month']) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
  })

  it('moves to the local month when the URL named none and the server month differs', () => {
    // Local Oct 31 8:30 PM; a UTC server (west-of-UTC viewer) already says November.
    jest.useFakeTimers({ now: new Date(2026, 9, 31, 20, 30) })
    render(<CalendarPageClient events={[]} currentMonth={11} currentYear={2026} monthFromUrl={false} />)
    expect(mockReplace).toHaveBeenCalledWith('/dashboard/calendar?year=2026&month=10')
  })

  it('stays put when the month came from the URL or already matches', () => {
    jest.useFakeTimers({ now: new Date(2026, 9, 31, 20, 30) })
    const { unmount } = render(<CalendarPageClient events={[]} currentMonth={11} currentYear={2026} />)
    unmount()
    render(<CalendarPageClient events={[]} currentMonth={10} currentYear={2026} monthFromUrl={false} />)
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('refreshes the calendar after quick capture saves', () => {
    render(<CalendarPageClient events={[]} currentMonth={10} currentYear={2026} />)
    screen.getByRole('button', { name: 'fake capture save' }).click()
    expect(mockRefresh).toHaveBeenCalled()
  })
})
