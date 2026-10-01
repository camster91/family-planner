/**
 * @jest-environment jsdom
 */
// The open sick day used to be a snapshot: after a parent logged a temperature
// or added a medication, the sheet kept showing the old data until it was
// closed and reopened. It now reads the sick day from the reloaded list.
import * as React from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastProvider } from '@/components/ui/toast'

const mockT = (key: string) => key
jest.mock('@/i18n', () => ({ useTranslation: () => ({ t: mockT }) }))
jest.mock('@/components/ui/feature-gate', () => ({
  FeatureGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

import SickDaysPage from '../page'

interface Temp {
  value: number
  unit: string
  at: string
}
interface Med {
  id: string
  sick_day_id: string | null
  person_id: string
  name: string
  dosage: string
  schedule: string
  next_dose_at: string | null
  last_dose_at: string | null
  active: boolean
  notes: string | null
}

let temps: Temp[]
let meds: Med[]

const sickDay = () => ({
  id: 'sd1',
  person_id: 'kid1',
  person_name: 'Sam',
  person_avatar: null,
  started_at: '2026-09-29T08:00:00Z',
  ended_at: null,
  symptoms: 'Cough',
  severity: 'mild',
  status: 'active',
  temperature_log: temps,
  notes: null,
  medications: [],
})

const reply = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => body }) as Response

beforeEach(() => {
  temps = []
  meds = []
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    if (url === '/api/sick-days') return reply({ sickDays: [sickDay()] })
    if (url === '/api/sick-days/sd1' && method === 'PATCH') {
      temps = [...temps, { ...body.addTemperature, at: '2026-10-01T09:00:00Z' }]
      return reply({ sickDay: sickDay() })
    }
    if (url === '/api/medications' && method === 'POST') {
      const med: Med = {
        id: 'm-new',
        sick_day_id: body.sick_day_id,
        person_id: body.person_id,
        name: body.name,
        dosage: body.dosage,
        schedule: body.schedule,
        next_dose_at: null,
        last_dose_at: null,
        active: true,
        notes: body.notes || null,
      }
      meds = [...meds, med]
      return reply({ medication: med }, 201)
    }
    if (url === '/api/medications') return reply({ medications: meds })
    if (url === '/api/family/members') return reply({ members: [{ id: 'kid1', name: 'Sam' }] })
    if (url === '/api/auth/me') return reply({ user: { id: 'p1', role: 'parent' } })
    return reply({})
  }) as unknown as typeof fetch
})

const renderPage = () =>
  render(
    <ToastProvider>
      <SickDaysPage />
    </ToastProvider>
  )

async function openDetail(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByText('Sam'))
  return screen.findByTestId('sick-day-detail')
}

describe('sick day detail', () => {
  it('shows a new temperature in the open sheet straight after it is saved', async () => {
    const user = userEvent.setup()
    renderPage()
    await openDetail(user)
    await screen.findByRole('button', { name: /sickDays.addTemperature/ })
    expect(screen.getByText('sickDays.noTemps')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: /sickDays.addTemperature/ }))
    const form = await screen.findByRole('dialog', { name: 'sickDays.addTemperature' })
    await user.type(within(form).getByLabelText('sickDays.temperature'), '101.2')
    await user.click(within(form).getByRole('button', { name: 'common.save' }))

    const detail = await screen.findByTestId('sick-day-detail')
    expect(await within(detail).findByText('101.2°F')).toBeTruthy()
    expect(within(detail).queryByText('sickDays.noTemps')).toBeNull()
  })

  it('accepts a decimal temperature (the number field allows tenths)', async () => {
    const user = userEvent.setup()
    renderPage()
    await openDetail(user)
    await user.click(await screen.findByRole('button', { name: /sickDays.addTemperature/ }))
    const form = await screen.findByRole('dialog', { name: 'sickDays.addTemperature' })
    const field = within(form).getByLabelText('sickDays.temperature') as HTMLInputElement
    expect(field.getAttribute('step')).toBe('0.1')
    await user.selectOptions(within(form).getByLabelText('sickDays.unit'), 'C')
    await user.type(field, '38.5')
    expect(field.validity.stepMismatch).toBe(false)
    expect(field.checkValidity()).toBe(true)
    await user.click(within(form).getByRole('button', { name: 'common.save' }))

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/sick-days/sd1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ addTemperature: { value: 38.5, unit: 'C' } }),
        })
      )
    )
  })

  it('shows a new medication in the open sheet straight after it is added', async () => {
    const user = userEvent.setup()
    renderPage()
    await openDetail(user)
    await user.click(await screen.findByRole('button', { name: /sickDays.addMedication/ }))

    const form = await screen.findByRole('dialog', { name: 'sickDays.addMedication' })
    await user.selectOptions(within(form).getByLabelText('sickDays.person'), 'kid1')
    await user.type(within(form).getByLabelText('sickDays.name'), 'Ibuprofen')
    await user.type(within(form).getByLabelText('sickDays.dosage'), '5ml')
    await user.type(within(form).getByLabelText('sickDays.schedule'), 'Every 6 hours')
    await user.click(within(form).getByRole('button', { name: 'common.save' }))

    const detail = await screen.findByTestId('sick-day-detail')
    expect(await within(detail).findByText('Ibuprofen')).toBeTruthy()
    expect(within(detail).queryByText('sickDays.noMedications')).toBeNull()
  })

  it('uses labelled dialogs with a named close button and labelled fields', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'sickDays.startSickDay' }))
    const dialog = screen.getByRole('dialog', { name: 'sickDays.startSickDay' })
    expect(within(dialog).getByLabelText('sickDays.person').tagName).toBe('SELECT')
    expect(within(dialog).getByLabelText('sickDays.severity.label').tagName).toBe('SELECT')
    expect(within(dialog).getByLabelText('sickDays.symptoms').tagName).toBe('TEXTAREA')

    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    const detail = await openDetail(user)
    expect(within(detail).getByRole('button', { name: 'Close' })).toBeTruthy()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('sick-day-detail')).toBeNull())
  })

  it('gives the add actions a 44px tap area', async () => {
    const user = userEvent.setup()
    renderPage()
    await openDetail(user)
    for (const name of [/sickDays.addTemperature/, /sickDays.addMedication/]) {
      expect((await screen.findByRole('button', { name })).className).toMatch(/min-h-\[44px\]/)
    }
  })
})
