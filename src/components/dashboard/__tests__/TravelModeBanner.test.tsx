/**
 * @jest-environment jsdom
 */
// The trip end date is a date-only value stored as UTC midnight. Formatted in
// local time it showed the day before for viewers west of UTC.
import * as React from 'react'
import { render, screen } from '@testing-library/react'

const mockT = (key: string, vars?: Record<string, string>) => `${key} ${JSON.stringify(vars ?? {})}`
jest.mock('@/i18n', () => ({ useTranslation: () => ({ t: mockT }) }))

import { TravelModeBanner } from '../TravelModeBanner'

// The runner's zone is not ours to pick, so simulate a viewer west of UTC:
// any local-time formatting (no explicit timeZone) lands in Toronto.
const realToLocaleDateString = Date.prototype.toLocaleDateString
beforeEach(() => {
  jest
    .spyOn(Date.prototype, 'toLocaleDateString')
    .mockImplementation(function (this: Date, locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
      return realToLocaleDateString.call(this, locales, { timeZone: 'America/Toronto', ...options })
    })
})
afterEach(() => jest.restoreAllMocks())

it('simulates a viewer west of UTC', () => {
  expect(new Date('2026-10-05T00:00:00.000Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })).toBe(
    'Oct 4'
  )
})

it('shows the stored end day, not the day before', async () => {
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({
      travel_mode_active: true,
      travel_start_date: '2026-10-01T00:00:00.000Z',
      travel_end_date: '2026-10-05T00:00:00.000Z',
      travel_destination: 'Lisbon',
    }),
  })) as unknown as typeof fetch
  render(<TravelModeBanner />)
  expect(await screen.findByText('travel.banner {"destination":"Lisbon","date":"Oct 5"}')).toBeTruthy()
})
