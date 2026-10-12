/**
 * @jest-environment jsdom
 */
// The header Print button used to print the "Select a card to preview"
// placeholder when no card was open. With nothing previewed it now prints every
// card; with a card previewed it prints just that one.
import * as React from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockT = (key: string) => key
jest.mock('@/i18n', () => ({ useTranslation: () => ({ t: mockT }) }))
jest.mock('@/components/ui/feature-gate', () => ({
  FeatureGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

import EmergencyPage from '../page'

const contact = (id: string, name: string) => ({
  id,
  person_id: null,
  person_name: name,
  relationship: 'child',
  blood_type: null,
  allergies: `${name} allergy`,
  medications: null,
  medical_conditions: null,
  doctor_name: null,
  doctor_phone: null,
  dentist_name: null,
  dentist_phone: null,
  insurance_provider: null,
  insurance_id: null,
  emergency_contact_name: null,
  emergency_contact_phone: null,
})

const reply = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response

let printSpy: jest.SpyInstance
let mutationReply: () => Promise<Response>

beforeEach(() => {
  printSpy = jest.spyOn(window, 'print').mockImplementation(() => {})
  mutationReply = async () => reply({})
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/auth/me') return reply({ user: { id: 'p1', role: 'parent' } })
    if ((init?.method ?? 'GET') !== 'GET') return mutationReply()
    if (url === '/api/emergency-contacts') return reply({ contacts: [contact('c1', 'Sam'), contact('c2', 'Alex')] })
    return reply({})
  }) as unknown as typeof fetch
})

afterEach(() => printSpy.mockRestore())

const printCards = () => Array.from(document.querySelectorAll<HTMLElement>('.print-card'))

it('prints every card when none is previewed', async () => {
  const user = userEvent.setup()
  render(<EmergencyPage />)
  await screen.findAllByText('Sam')

  const cards = printCards()
  expect(cards).toHaveLength(1)
  expect(cards[0]).toBe(screen.getByTestId('emergency-print-all'))
  expect(cards[0].textContent).toContain('Sam allergy')
  expect(cards[0].textContent).toContain('Alex allergy')
  // The on-screen placeholder is never part of the printout.
  expect(cards[0].textContent).not.toContain('Select a card to preview')
  expect(screen.getByText('Select a card to preview').closest('.no-print')).not.toBeNull()

  const headerPrint = screen.getByRole('button', { name: 'emergency.print' })
  expect(headerPrint.className).toMatch(/min-h-\[44px\]/)
  await user.click(headerPrint)
  expect(printSpy).toHaveBeenCalledTimes(1)
})

it('prints only the previewed card when one is open', async () => {
  const user = userEvent.setup()
  render(<EmergencyPage />)
  await user.click((await screen.findAllByText('Alex'))[0])

  expect(screen.queryByTestId('emergency-print-all')).toBeNull()
  const cards = printCards()
  expect(cards).toHaveLength(1)
  expect(cards[0]).toBe(screen.getByTestId('emergency-preview'))
  expect(within(cards[0]).getByText('Alex allergy')).toBeTruthy()
  expect(cards[0].textContent).not.toContain('Sam allergy')
})

it('keeps the emergency draft open and non-dismissible while saving', async () => {
  const user = userEvent.setup()
  let release!: () => void
  mutationReply = () => new Promise<Response>((resolve) => {
    release = () => resolve(reply({ contacts: [contact('c1', 'Sam')] }))
  })

  render(<EmergencyPage />)
  await user.click(await screen.findByRole('button', { name: 'emergency.addCard' }))
  await user.type(screen.getByLabelText('emergency.personName'), 'Jordan')
  await user.click(screen.getByRole('button', { name: 'common.save' }))

  expect((screen.getByRole('button', { name: 'common.saving' }) as HTMLButtonElement).disabled).toBe(true)
  await user.keyboard('{Escape}')
  expect(screen.getByRole('dialog')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()

  release()
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})
