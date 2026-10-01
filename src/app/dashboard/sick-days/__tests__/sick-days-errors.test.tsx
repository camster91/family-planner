/**
 * @jest-environment jsdom
 */
// Sick days (off by default, reachable by teens and children): a failed load
// used to show "no sick days", and a refused or offline save did nothing or
// left an unhandled rejection. Failures now say so (O-26).
import * as React from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastProvider } from '@/components/ui/toast'
import { OFFLINE_MESSAGE } from '@/lib/fetch-error'

const mockT = (key: string) => key
jest.mock('@/i18n', () => ({ useTranslation: () => ({ t: mockT }) }))
jest.mock('@/components/ui/feature-gate', () => ({
  FeatureGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

import SickDaysPage from '../page'

type Handler = (method: string, body: unknown) => { status: number; body: unknown } | 'network-error'
let routes: Record<string, Handler>
let calls: { url: string; method: string }[] = []
let unhandled: unknown[] = []
const onUnhandled = (reason: unknown) => unhandled.push(reason)

const SICK_DAY = {
  id: 'sd1',
  person_id: 'kid1',
  person_name: 'Sam',
  person_avatar: null,
  started_at: '2026-09-29T08:00:00Z',
  ended_at: null,
  symptoms: 'Cough',
  severity: 'mild',
  status: 'active',
  temperature_log: [],
  notes: null,
  medications: [],
}
const MED = {
  id: 'm1',
  sick_day_id: 'sd1',
  person_id: 'kid1',
  name: 'Syrup',
  dosage: '5ml',
  schedule: 'Twice daily',
  next_dose_at: null,
  last_dose_at: null,
  active: true,
  notes: null,
}

const ok = (body: unknown) => ({ status: 200, body })

// What the server has saved: a reload returns the saved dose times.
let medState: Omit<typeof MED, 'last_dose_at' | 'next_dose_at'> & { last_dose_at: string | null; next_dose_at: string | null }

beforeEach(() => {
  medState = { ...MED }
  calls = []
  unhandled = []
  process.on('unhandledRejection', onUnhandled)
  routes = {
    '/api/sick-days': () => ok({ sickDays: [SICK_DAY] }),
    '/api/family/members': () => ok({ members: [{ id: 'kid1', name: 'Sam' }] }),
    '/api/medications': () => ok({ medications: [medState] }),
    '/api/auth/me': () => ok({ user: { id: 'kid1', role: 'child' } }),
  }
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    calls.push({ url, method })
    const handler = routes[url]
    const reply = handler ? handler(method, init?.body ? JSON.parse(String(init.body)) : undefined) : ok({})
    if (reply === 'network-error') throw new TypeError('Failed to fetch')
    return { ok: reply.status < 400, status: reply.status, json: async () => reply.body } as Response
  }) as unknown as typeof fetch
})

afterEach(() => {
  process.off('unhandledRejection', onUnhandled)
})

const renderPage = () =>
  render(
    <ToastProvider>
      <SickDaysPage />
    </ToastProvider>
  )

describe('sick days page errors', () => {
  it('a failed load says so instead of showing the empty state, and Try again reloads', async () => {
    routes['/api/sick-days'] = () => ({ status: 500, body: { error: 'Internal server error' } })
    const user = userEvent.setup()
    renderPage()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/Couldn.t load sick days/)
    expect(screen.queryByText('sickDays.empty')).toBeNull()

    routes['/api/sick-days'] = () => ok({ sickDays: [SICK_DAY] })
    await user.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Sam')).toBeTruthy()
    expect(screen.queryByText(/Couldn.t load sick days/)).toBeNull()
  })

  it('an offline load shows the same message with no unhandled rejection', async () => {
    routes['/api/sick-days'] = () => 'network-error'
    renderPage()
    expect((await screen.findByRole('alert')).textContent).toMatch(/Couldn.t load sick days/)
    await new Promise((r) => setTimeout(r, 0))
    expect(unhandled).toEqual([])
  })

  it('a refused start shows the server reason in a toast', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Sam')
    routes['/api/sick-days'] = (method) =>
      method === 'POST' ? { status: 403, body: { error: 'You can only report yourself' } } : ok({ sickDays: [SICK_DAY] })

    await user.click(screen.getByRole('button', { name: 'sickDays.startSickDay' }))
    await user.selectOptions(screen.getAllByRole('combobox')[0], 'kid1')
    await user.click(screen.getByRole('button', { name: 'common.save' }))

    expect(await screen.findByText("Couldn't start the sick day")).toBeTruthy()
    expect(screen.getByText('You can only report yourself')).toBeTruthy()
  })

  it('an offline start shows a connection toast and no unhandled rejection', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Sam')
    routes['/api/sick-days'] = (method) => (method === 'POST' ? 'network-error' : ok({ sickDays: [SICK_DAY] }))

    await user.click(screen.getByRole('button', { name: 'sickDays.startSickDay' }))
    await user.selectOptions(screen.getAllByRole('combobox')[0], 'kid1')
    await user.click(screen.getByRole('button', { name: 'common.save' }))

    expect(await screen.findByText("Couldn't start the sick day")).toBeTruthy()
    expect(screen.getByText(OFFLINE_MESSAGE)).toBeTruthy()
    // The form stays usable.
    await waitFor(() => expect(screen.getByRole('button', { name: 'common.save' })).toHaveProperty('disabled', false))
    expect(unhandled).toEqual([])
  })

  it('an offline dose log shows a toast and no unhandled rejection', async () => {
    routes['/api/medications/m1'] = () => 'network-error'
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByText('Sam'))
    await user.click(screen.getByRole('button', { name: /sickDays.markDoseTaken/ }))

    expect(await screen.findByText("Couldn't log the dose")).toBeTruthy()
    await new Promise((r) => setTimeout(r, 0))
    expect(unhandled).toEqual([])
    expect(calls.filter((c) => c.url === '/api/medications/m1' && c.method === 'PATCH')).toHaveLength(1)
  })

  it('a logged dose shows the last dose time, never a guessed next dose, and a parent may set one', async () => {
    const takenAt = '2026-10-01T10:00:00.000Z'
    const bodies: unknown[] = []
    routes['/api/auth/me'] = () => ok({ user: { id: 'p1', role: 'parent' } })
    routes['/api/medications/m1'] = (_method, body) => {
      bodies.push(body)
      const b = body as { next_dose_at?: string }
      medState = { ...medState, last_dose_at: takenAt, next_dose_at: b.next_dose_at ?? null }
      return ok({ medication: medState })
    }
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByText('Sam'))
    await user.click(screen.getByRole('button', { name: /sickDays.markDoseTaken/ }))

    expect(await screen.findByText(/sickDays.lastDoseAt/)).toBeTruthy()
    expect(screen.queryByText(/sickDays.nextDoseSetFor/)).toBeNull()
    expect(bodies[0]).toEqual({ markDoseTaken: true })

    await user.type(screen.getByLabelText('sickDays.nextDoseInHours'), '6')
    await user.click(screen.getByRole('button', { name: 'sickDays.setNextDose' }))

    expect(await screen.findByText(/sickDays.nextDoseSetFor/)).toBeTruthy()
    expect(bodies[1]).toEqual({ next_dose_at: '2026-10-01T16:00:00.000Z' })
    expect(screen.queryByLabelText('sickDays.nextDoseInHours')).toBeNull()
  })

  it('a child logging a dose is not offered a next dose time', async () => {
    routes['/api/medications/m1'] = () => {
      medState = { ...MED, last_dose_at: '2026-10-01T10:00:00.000Z', next_dose_at: null }
      return ok({ medication: medState })
    }
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByText('Sam'))
    await user.click(screen.getByRole('button', { name: /sickDays.markDoseTaken/ }))

    expect(await screen.findByText(/sickDays.lastDoseAt/)).toBeTruthy()
    expect(screen.queryByLabelText('sickDays.nextDoseInHours')).toBeNull()
  })
})
