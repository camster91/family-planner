/**
 * @jest-environment jsdom
 */
// Travel page dates (O-31): trip dates and chore due dates are date-only
// values stored as UTC midnight. West of UTC they used to show a day early,
// and turning travel mode on sent the current UTC instant as the start date.
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastProvider } from '@/components/ui/toast'
import { toDateOnlyLocal } from '@/lib/dates'

const mockT = (key: string, vars?: Record<string, string>) => (vars ? `${key} ${JSON.stringify(vars)}` : key)
jest.mock('@/i18n', () => ({ useTranslation: () => ({ t: mockT }) }))
jest.mock('@/components/ui/feature-gate', () => ({
  FeatureGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

import TravelPage from '../page'

const ACTIVE = {
  travel_mode_active: true,
  travel_start_date: '2026-10-01T00:00:00.000Z',
  travel_end_date: '2026-10-05T00:00:00.000Z',
  travel_destination: 'Lisbon',
}
const INACTIVE = {
  travel_mode_active: false,
  travel_start_date: null,
  travel_end_date: null,
  travel_destination: null,
}
const CHORES = [
  { id: 'c1', title: 'Water plants', due_date: '2026-10-03T00:00:00.000Z', status: 'pending', assignee: { name: 'Sam' } },
  // Day after the trip ends: outside the window even though local time puts it on Oct 5.
  { id: 'c2', title: 'Take out bins', due_date: '2026-10-06T00:00:00.000Z', status: 'pending', assignee: null },
]

let travelState: typeof ACTIVE | typeof INACTIVE
let patches: Record<string, unknown>[]
let choreUrls: string[]

// The runner's zone is not ours to pick, so simulate a viewer west of UTC:
// any local-time formatting (no explicit timeZone) lands in Toronto.
const realToLocaleDateString = Date.prototype.toLocaleDateString
afterEach(() => jest.restoreAllMocks())

beforeEach(() => {
  jest
    .spyOn(Date.prototype, 'toLocaleDateString')
    .mockImplementation(function (this: Date, locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
      return realToLocaleDateString.call(this, locales, { timeZone: 'America/Toronto', ...options })
    })
  patches = []
  choreUrls = []
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/chores')) {
      choreUrls.push(url)
      return { ok: true, json: async () => ({ chores: CHORES }) }
    }
    if (init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body))
      patches.push(body)
      return { ok: true, json: async () => ({ ...travelState, ...body }) }
    }
    return { ok: true, json: async () => travelState }
  }) as unknown as typeof fetch
})

function renderPage() {
  return render(
    <ToastProvider>
      <TravelPage />
    </ToastProvider>
  )
}

it('simulates a viewer west of UTC', () => {
  expect(new Date('2026-10-05T00:00:00.000Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })).toBe(
    'Oct 4'
  )
})

it('shows the stored trip end day and chore due days', async () => {
  travelState = ACTIVE
  renderPage()
  expect(await screen.findByText('travel.awayBanner {"date":"Oct 5, 2026"}')).toBeTruthy()
  expect(await screen.findByText('Water plants')).toBeTruthy()
  expect(screen.getByText('Oct 3')).toBeTruthy()
  expect(screen.queryByText('Take out bins')).toBeNull()
  expect((screen.getByLabelText('travel.startDate') as HTMLInputElement).value).toBe('2026-10-01')
  expect((screen.getByLabelText('travel.endDate') as HTMLInputElement).value).toBe('2026-10-05')
  // Only the trip's chores are asked for, never the whole household's.
  expect(choreUrls).toEqual(['/api/chores?from=2026-10-01&to=2026-10-05'])
})

it('starts the trip on the local today as a date-only value', async () => {
  travelState = INACTIVE
  renderPage()
  await userEvent.click(await screen.findByRole('button', { name: 'Turn on travel mode' }))
  await waitFor(() => expect(patches).toHaveLength(1))
  expect(patches[0].travel_start_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  expect(patches[0]).toEqual({
    travel_mode_active: true,
    travel_start_date: toDateOnlyLocal(new Date()),
    travel_end_date: null,
    travel_destination: '',
  })
  // No trip dates yet when off: no chore list is downloaded.
  expect(choreUrls).toEqual([])
})
