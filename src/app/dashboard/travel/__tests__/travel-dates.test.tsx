/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
// Travel page dates (O-31): trip dates and chore due dates are date-only
// values stored as UTC midnight. West of UTC they used to show a day early,
// and turning travel mode on sent the current UTC instant as the start date.
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nProvider } from '@/i18n'
import { ToastProvider } from '@/components/ui/toast'
import { toDateOnlyLocal } from '@/lib/dates'

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
let travelLoadFailures: number
let choreLoadFailures: number
let travelBodyOverride: unknown
let choreBodyOverride: unknown
let patchBodyOverride: unknown

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
  travelLoadFailures = 0
  choreLoadFailures = 0
  travelBodyOverride = undefined
  choreBodyOverride = undefined
  patchBodyOverride = undefined
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/chores')) {
      choreUrls.push(url)
      if (choreLoadFailures > 0) {
        choreLoadFailures -= 1
        return { ok: false, status: 503, json: async () => ({ error: 'temporary chore failure' }) }
      }
      return { ok: true, json: async () => choreBodyOverride ?? { chores: CHORES } }
    }
    if (init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body))
      patches.push(body)
      return { ok: true, json: async () => patchBodyOverride ?? { ...travelState, ...body } }
    }
    if (travelLoadFailures > 0) {
      travelLoadFailures -= 1
      return { ok: false, status: 503, json: async () => ({ error: 'temporary travel failure' }) }
    }
    return { ok: true, json: async () => travelBodyOverride ?? travelState }
  }) as unknown as typeof fetch
})

function renderPage(locale: 'en' | 'es' = 'en') {
  return render(
    <I18nProvider locale={locale}>
      <ToastProvider>
        <TravelPage />
      </ToastProvider>
    </I18nProvider>
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
  expect(await screen.findByText('Away until Oct 5, 2026')).toBeTruthy()
  expect(await screen.findByText('Water plants')).toBeTruthy()
  expect(screen.getByText('Oct 3')).toBeTruthy()
  expect(screen.queryByText('Take out bins')).toBeNull()
  expect((screen.getByLabelText('Start date') as HTMLInputElement).value).toBe('2026-10-01')
  expect((screen.getByLabelText('End date') as HTMLInputElement).value).toBe('2026-10-05')
  // Only the trip's chores are asked for, never the whole household's.
  expect(choreUrls).toEqual(['/api/chores?from=2026-10-01&to=2026-10-05'])
})

it('starts the trip on the local today as a date-only value', async () => {
  travelState = INACTIVE
  renderPage()
  await userEvent.click(await screen.findByRole('switch', { name: 'Turn on travel mode' }))
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

it('does not show an OFF control after the travel load fails and recovers with an inline retry', async () => {
  travelState = ACTIVE
  travelLoadFailures = 1
  renderPage()

  expect(await screen.findByRole('alert')).toHaveTextContent('Travel mode is unavailable')
  expect(screen.queryByRole('switch')).toBeNull()
  expect(screen.queryByText('Off')).toBeNull()

  await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

  expect(await screen.findByRole('switch', { name: 'Turn off travel mode' })).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()
})

it('treats a malformed successful travel response as unavailable until an explicit retry returns canonical state', async () => {
  travelState = ACTIVE
  travelBodyOverride = {}
  renderPage()

  expect(await screen.findByRole('alert')).toHaveTextContent('Travel mode is unavailable')
  expect(screen.queryByRole('switch')).toBeNull()

  travelBodyOverride = undefined
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

  expect(await screen.findByRole('switch', { name: 'Turn off travel mode' })).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()
})

it('distinguishes unavailable trip chores from an empty trip and retries without changing the trip', async () => {
  travelState = ACTIVE
  choreLoadFailures = 1
  renderPage()

  expect(await screen.findByRole('alert')).toHaveTextContent('Pending chores are unavailable')
  expect(screen.queryByText('No pending chores during this period')).toBeNull()
  expect(patches).toEqual([])

  await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

  expect(await screen.findByText('Water plants')).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(patches).toEqual([])
  expect(choreUrls).toEqual([
    '/api/chores?from=2026-10-01&to=2026-10-05',
    '/api/chores?from=2026-10-01&to=2026-10-05',
  ])
})

it('treats a malformed successful chore response as unavailable instead of empty', async () => {
  travelState = ACTIVE
  choreBodyOverride = { chores: [{ id: 'c1', title: 'Water plants' }] }
  renderPage()

  expect(await screen.findByRole('alert')).toHaveTextContent('Pending chores are unavailable')
  expect(screen.queryByText('No pending chores during this period')).toBeNull()

  choreBodyOverride = undefined
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

  expect(await screen.findByText('Water plants')).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()
})

it('uses Spanish travel copy for controls and localized recovery feedback', async () => {
  travelState = INACTIVE
  renderPage('es')

  expect(await screen.findByRole('switch', { name: 'Activar modo viaje' })).toBeTruthy()
  expect(screen.getByText('Desactivado')).toBeTruthy()
  expect(screen.getByText('No están viajando. Activa el modo viaje cuando estén fuera.')).toBeTruthy()
  expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
})

it('latches same-tick toggle and details saves while retaining the draft after refusal', async () => {
  travelState = ACTIVE
  let releasePatch!: (response: Response) => void
  const pendingPatch = new Promise<Response>((resolve) => {
    releasePatch = resolve
  })
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/chores')) return { ok: true, json: async () => ({ chores: [] }) }
    if (init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body))
      patches.push(body)
      return pendingPatch
    }
    return { ok: true, json: async () => travelState }
  }) as unknown as typeof fetch

  const user = userEvent.setup()
  renderPage()
  await screen.findByRole('switch', { name: 'Turn off travel mode' })
  const destination = screen.getByLabelText('Destination') as HTMLInputElement
  await user.clear(destination)
  await user.type(destination, 'Lisbon')

  const toggle = screen.getByRole('switch', { name: 'Turn off travel mode' })
  const save = screen.getByRole('button', { name: 'Save' })
  await user.click(toggle)
  await user.click(save)
  expect(patches).toHaveLength(1)
  expect(toggle).toBeDisabled()
  expect(save).toBeDisabled()

  releasePatch({ ok: false, status: 403, json: async () => ({ error: 'Parents only' }) } as Response)
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("Couldn't change travel mode"))
  expect(destination).toHaveValue('Lisbon')
  expect(screen.getByRole('alert')).not.toHaveTextContent('Parents only')
})

it('keeps the confirmed control state and draft after a malformed successful PATCH, then recovers on an explicit save', async () => {
  travelState = ACTIVE
  patchBodyOverride = { travel_mode_active: 'yes' }
  renderPage()

  await screen.findByRole('switch', { name: 'Turn off travel mode' })
  const destination = screen.getByLabelText('Destination') as HTMLInputElement
  await userEvent.clear(destination)
  await userEvent.type(destination, 'Lisbon')
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))

  expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't save the trip details")
  expect(screen.getByRole('switch', { name: 'Turn off travel mode' })).toBeTruthy()
  expect(screen.queryByRole('switch', { name: 'Turn on travel mode' })).toBeNull()
  expect(destination).toHaveValue('Lisbon')
  expect(patches).toHaveLength(1)

  patchBodyOverride = ACTIVE
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(patches).toHaveLength(2))
  expect(screen.getByRole('switch', { name: 'Turn off travel mode' })).toBeTruthy()
})
