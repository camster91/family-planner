/**
 * @jest-environment jsdom
 */
// Teens and children read the emergency cards too. They see relationships
// from their own side ("You", "Parent"), allergy and medicine chips on each
// row, tap-to-call phone numbers, and children get no Print button.
import * as React from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockT = (key: string) => key
jest.mock('@/i18n', () => ({ useTranslation: () => ({ t: mockT }) }))
jest.mock('@/components/ui/feature-gate', () => ({
  FeatureGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

import EmergencyPage from '../page'

const contact = (id: string, name: string, relationship: string, person_id: string | null, extra = {}) => ({
  id,
  person_id,
  person_name: name,
  relationship,
  blood_type: null,
  allergies: null,
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
  emergency_contact_relation: null,
  notes: null,
  ...extra,
})

const contacts = [
  contact('c-mom', 'Mom', 'self', 'mom', { doctor_name: 'Dr. Lee', doctor_phone: '(555) 123-4567' }),
  contact('c-kid', 'Emma', 'child', 'kid1', { allergies: 'Peanuts', medications: 'Inhaler' }),
  contact('c-teen', 'Alex', 'child', 'teen1'),
]

const reply = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body }) as Response

function serve(user: { id: string; role: string; name: string }) {
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url === '/api/auth/me') return reply({ user })
    if (url === '/api/emergency-contacts') return reply({ contacts })
    if (url === '/api/family/members')
      return reply({
        members: [
          { id: 'mom', name: 'Mom', role: 'parent' },
          { id: 'kid1', name: 'Emma', role: 'child' },
          { id: 'teen1', name: 'Alex', role: 'teen' },
        ],
      })
    return reply({})
  }) as unknown as typeof fetch
}

it('labels cards from a child’s side and hides Print for children', async () => {
  serve({ id: 'kid1', role: 'child', name: 'Emma' })
  render(<EmergencyPage />)
  const own = await screen.findByTestId('emergency-row-c-kid')
  await waitFor(() => expect(within(own).getByText('emergency.viewer.you')).toBeTruthy())
  expect(within(screen.getByTestId('emergency-row-c-mom')).getByText('emergency.viewer.parent')).toBeTruthy()
  await waitFor(() =>
    expect(within(screen.getByTestId('emergency-row-c-teen')).getByText('emergency.viewer.teen')).toBeTruthy(),
  )
  expect(screen.queryByText('emergency.relationships.self')).toBeNull()
  expect(screen.queryByText('emergency.relationships.child')).toBeNull()
  expect(screen.queryByRole('button', { name: 'emergency.print' })).toBeNull()

  await userEvent.setup().click(own)
  const preview = screen.getByTestId('emergency-preview')
  expect(within(preview).getByText('emergency.viewer.you')).toBeTruthy()
  expect(within(preview).queryByRole('button', { name: 'emergency.print' })).toBeNull()
})

it('keeps Print and the stored wording for parents', async () => {
  serve({ id: 'mom', role: 'parent', name: 'Mom' })
  render(<EmergencyPage />)
  expect(await screen.findByRole('button', { name: 'emergency.print' })).toBeTruthy()
  expect(within(screen.getByTestId('emergency-row-c-mom')).getByText('emergency.relationships.self')).toBeTruthy()
  expect(within(screen.getByTestId('emergency-row-c-kid')).getByText('emergency.relationships.child')).toBeTruthy()
})

it('shows allergy and medicine chips on the row, labelled in text', async () => {
  serve({ id: 'teen1', role: 'teen', name: 'Alex' })
  render(<EmergencyPage />)
  const row = await screen.findByTestId('emergency-row-c-kid')
  // The test translator returns keys, so the chip shows its label key.
  expect(within(row).getByText('emergency.chipAllergies')).toBeTruthy()
  expect(within(row).getByText('emergency.chipMedications')).toBeTruthy()
  expect(within(screen.getByTestId('emergency-row-c-teen')).queryByText('emergency.chipAllergies')).toBeNull()
  // Teens can still print.
  expect(await screen.findByRole('button', { name: 'emergency.print' })).toBeTruthy()
})

it('opens the full card from a row, with tap-to-call numbers and no empty preview panel on phones', async () => {
  serve({ id: 'mom', role: 'parent', name: 'Mom' })
  const user = userEvent.setup()
  render(<EmergencyPage />)
  const placeholder = (await screen.findByTestId('emergency-preview'))
  // The "select a card" panel is desktop-only.
  expect(placeholder.className).toMatch(/\bhidden\b/)
  expect(placeholder.className).toMatch(/md:block/)

  await user.click(screen.getByTestId('emergency-row-c-mom'))
  const preview = screen.getByTestId('emergency-preview')
  expect(preview.className).not.toMatch(/(^|\s)hidden(\s|$)/)
  expect(preview.className).toMatch(/order-first/)
  const call = within(preview).getByRole('link', { name: 'emergency.callNumber' })
  expect(call.getAttribute('href')).toBe('tel:5551234567')
  expect(call.textContent).toBe('(555) 123-4567')
  await waitFor(() => expect(document.activeElement).toBe(within(preview).getByRole('heading', { name: 'Mom' })))
})
