/**
 * @jest-environment jsdom
 */
// Teen calendar (owner decision O-37): a teen sees the household's events and
// may add one (POST /api/events is open to every member), but editing and
// deleting are parent-only in the API, so no event row links to the editor.
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import CalendarPageClient from '../CalendarPageClient'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn(), replace: jest.fn(), push: jest.fn() }),
}))
jest.mock('@/components/capture/CaptureBox', () => ({ CaptureBox: () => null }))

const START = new Date(2026, 9, 15, 10, 0).toISOString()
const EVENTS = [
  { id: 'e1', title: 'Dentist', start_time: START, end_time: START, event_type: 'appointment' },
  {
    id: 'e2',
    title: 'Soccer game',
    start_time: START,
    end_time: START,
    event_type: 'other',
    source: { subscription_id: 's1', name: 'Team', color: null },
  },
]

function editLinks(container: HTMLElement) {
  return Array.from(container.querySelectorAll('a')).filter((a) =>
    a.getAttribute('href')?.startsWith('/dashboard/calendar/edit')
  )
}

describe('calendar write controls by role', () => {
  it('a teen sees every event and Add event, but no edit links', () => {
    const { container } = render(
      <CalendarPageClient events={EVENTS} currentMonth={10} currentYear={2026} canEditEvents={false} />
    )
    expect(screen.getByText('Dentist')).toBeTruthy()
    expect(screen.getByText('Soccer game')).toBeTruthy()
    expect(screen.getByText('appointment')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Add event' }).getAttribute('href')).toBe('/dashboard/calendar/create')
    expect(editLinks(container)).toHaveLength(0)
  })

  it('a parent gets the edit link on events made in the app (not imported ones)', () => {
    const { container } = render(
      <CalendarPageClient events={EVENTS} currentMonth={10} currentYear={2026} canEditEvents />
    )
    expect(editLinks(container).map((a) => a.getAttribute('href'))).toEqual(['/dashboard/calendar/edit?id=e1'])
  })
})
