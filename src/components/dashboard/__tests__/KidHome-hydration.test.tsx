/**
 * @jest-environment jsdom
 */
// O-31: the server renders in UTC, the browser in the viewer's zone (and a
// moment later). Kid home's "today" (missions, routines, today's events and
// their times) is the viewer's local day, so the server HTML and the first
// client render leave it out (a placeholder holds its place) and hydration has
// nothing to disagree about; after mount the local day and local times show.
import * as React from 'react'
import { screen, within } from '@testing-library/react'
import KidHome from '../KidHome'
import { ToastProvider } from '@/components/ui/toast'
import { FeaturesProvider } from '@/components/providers/features-provider'
import { defaultFeatures } from '@/lib/features'
import { serverRenderThenHydrate, type Hydrated } from '@/components/ui/__tests__/ssr-hydration'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }),
}))

// The server renders just before local midnight, the browser hydrates just
// after: they disagree about which day is "today", as a UTC server and a
// viewer west of UTC do every evening. Built in local time, so any TZ works.
const SERVER_NOW = new Date(2026, 9, 1, 23, 59, 30)
const CLIENT_NOW = new Date(2026, 9, 2, 0, 0, 30)
const EVENT_START = new Date(2026, 9, 2, 9, 0).toISOString()
const EVENT_TIME = new Date(EVENT_START).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

let hydrated: Hydrated | null = null
beforeEach(() => jest.useFakeTimers())
afterEach(() => {
  hydrated?.unmount()
  hydrated = null
  jest.useRealTimers()
})

const chore = (id: string, title: string, due_date: string) => ({
  id,
  title,
  status: 'pending',
  due_date,
  icon: null,
  routine: null,
  routine_order: null,
})

function ui() {
  return (
    <FeaturesProvider initial={{ ...defaultFeatures(), gamification: true, rewards: true }}>
      <ToastProvider>
        <KidHome
          user={{ name: 'Casey', role: 'child' }}
          chores={[
            // Date-only values, stored at UTC midnight of the calendar day.
            // Oct 1: the server's "today", already past for the viewer.
            chore('c1', 'Brush teeth', '2026-10-01T00:00:00.000Z'),
            // Oct 2: the viewer's today.
            chore('c2', 'Water plants', '2026-10-02T00:00:00.000Z'),
            // Oct 3: the viewer's tomorrow.
            chore('c3', 'Pack bag', '2026-10-03T00:00:00.000Z'),
          ]}
          events={[{ id: 'e1', title: 'Movie night', start_time: EVENT_START }]}
          rewards={[]}
        />
      </ToastProvider>
    </FeaturesProvider>
  )
}

const hydrate = () => serverRenderThenHydrate(ui(), { serverNow: SERVER_NOW, clientNow: CLIENT_NOW })

describe('KidHome server render vs hydration', () => {
  it('server HTML holds a placeholder instead of a guessed "today"', () => {
    hydrated = hydrate()
    expect(hydrated.html).toContain('data-testid="kid-home-pending"')
    expect(hydrated.html).not.toContain('Missions')
    expect(hydrated.html).not.toContain('Still to do')
    expect(hydrated.html).not.toContain('All done for today!')
    expect(hydrated.html).not.toContain('Brush teeth')
    expect(hydrated.html).not.toContain('Movie night')
    expect(hydrated.html).not.toMatch(/\d:\d\d\s?[AP]M/)
  })

  it('hydrates on a different local day with no mismatch, then shows the local day and time', () => {
    hydrated = hydrate()
    expect(hydrated.recoverable).toEqual([])
    expect(hydrated.errors).toEqual([])

    expect(screen.queryByTestId('kid-home-pending')).toBeNull()
    const missions = screen.getByText("Today's Missions").closest('section') as HTMLElement
    expect(within(missions).getByText('Water plants')).toBeTruthy()
    expect(within(missions).queryByText('Brush teeth')).toBeNull()
    const earlier = screen.getByText('Still to do').closest('section') as HTMLElement
    expect(within(earlier).getByText('Brush teeth')).toBeTruthy()
    expect(within(earlier).getByText('Was due yesterday')).toBeTruthy()
    const tomorrow = screen.getByText('Tomorrow', { selector: 'p' }).closest('section') as HTMLElement
    expect(within(tomorrow).getByText('Pack bag')).toBeTruthy()
    const comingUp = screen.getByText('Coming up').closest('section') as HTMLElement
    expect(within(comingUp).getByText('Movie night')).toBeTruthy()
    expect(within(comingUp).getByText(EVENT_TIME)).toBeTruthy()
  })
})
