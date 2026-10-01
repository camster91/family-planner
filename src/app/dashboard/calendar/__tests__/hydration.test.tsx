/**
 * @jest-environment jsdom
 */
// O-31: the server renders in UTC, the browser in the viewer's zone. Before
// hydration the calendar groups and labels days by UTC date, with no
// "Today"/"Tomorrow" and no times, so the server HTML and the first client
// render match; after mount it shows the viewer's local day labels and times.
import * as React from 'react'
import { screen, within } from '@testing-library/react'
import CalendarPageClient from '../CalendarPageClient'
import { serverRenderThenHydrate, type Hydrated } from '@/components/ui/__tests__/ssr-hydration'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn(), replace: jest.fn(), push: jest.fn() }),
}))
jest.mock('@/components/capture/CaptureBox', () => ({
  CaptureBox: () => null,
}))

// Server just before local midnight, browser just after (see ssr-hydration):
// the event is "Tomorrow" for one and "Today" for the other.
const SERVER_NOW = new Date(2026, 9, 1, 23, 59, 30)
const CLIENT_NOW = new Date(2026, 9, 2, 0, 0, 30)
const START = new Date(2026, 9, 2, 9, 0).toISOString()
const LOCAL_TIME = new Date(START).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
const UTC_DAY = new Date(START).toLocaleDateString('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
})

const events = [
  { id: 'e1', title: 'Dentist', start_time: START, end_time: START, event_type: 'appointment', location: 'Main St' },
]

let hydrated: Hydrated | null = null
beforeEach(() => jest.useFakeTimers())
afterEach(() => {
  hydrated?.unmount()
  hydrated = null
  jest.useRealTimers()
})

const hydrate = () =>
  serverRenderThenHydrate(<CalendarPageClient events={events} currentMonth={10} currentYear={2026} />, {
    serverNow: SERVER_NOW,
    clientNow: CLIENT_NOW,
  })

describe('calendar server render vs hydration', () => {
  it('server HTML labels days by UTC date and leaves times out', () => {
    hydrated = hydrate()
    expect(hydrated.html).toContain(`>${UTC_DAY}</p>`)
    expect(hydrated.html).not.toContain('>Today<')
    expect(hydrated.html).not.toContain('>Tomorrow<')
    expect(hydrated.html).toContain('Dentist')
    expect(hydrated.html).toContain('>Main St<')
    expect(hydrated.html).not.toMatch(/\d:\d\d\s?[AP]M/)
  })

  it('hydrates with no mismatch, then shows the local day label and time', () => {
    hydrated = hydrate()
    expect(hydrated.recoverable).toEqual([])
    expect(hydrated.errors).toEqual([])

    const day = screen.getByText('Today', { selector: 'p' }).closest('section') as HTMLElement
    expect(within(day).getByText('Dentist')).toBeTruthy()
    expect(within(day).getByText(`${LOCAL_TIME} · Main St`)).toBeTruthy()
  })
})
