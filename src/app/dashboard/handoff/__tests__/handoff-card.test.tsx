/**
 * @jest-environment jsdom
 */
// The in-app handoff card puts emergency notes first and makes them stand out,
// shows friendly times without seconds, and makes phone numbers tappable.
import * as React from 'react'
import { render, screen, within } from '@testing-library/react'
import { ToastProvider } from '@/components/ui/toast'
import { handoffEnglish, handoffSpanish } from '@/i18n/handoff'

const mockT = (key: string) => key
jest.mock('@/i18n', () => ({ useTranslation: () => ({ t: mockT, locale: 'en' }) }))
jest.mock('@/components/ui/feature-gate', () => ({
  FeatureGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

import HandoffPage from '../page'

const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response

beforeEach(() => {
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url === '/api/auth/me') return reply({ user: { id: 'p1', role: 'parent' } })
    if (url === '/api/handoff')
      return reply({
        handoffs: [
          {
            id: 'h1',
            sitter_name: 'Sarah',
            sitter_phone: '555-0100',
            arrival_time: '2027-01-08T18:00:00.000Z',
            departure_time: '2027-01-08T23:30:00.000Z',
            kids_bedtimes: '8pm',
            emergency_notes: 'Peanut allergy. Call Dr. Lee 555-0199.',
            house_notes: null,
          },
        ],
      })
    return reply({})
  }) as unknown as typeof fetch
})

it('shows emergency notes first, with friendly times and tap-to-call numbers', async () => {
  render(
    <ToastProvider>
      <HandoffPage />
    </ToastProvider>,
  )
  await screen.findByText('Sarah')
  const card = screen.getByTestId('handoff-card-h1')
  const emergency = within(card).getByTestId('handoff-emergency-h1')
  expect(within(emergency).getByRole('heading', { name: 'handoff.emergencyNotes' })).toBeTruthy()
  expect(emergency.textContent).toContain('Peanut allergy')
  // Emergency notes come before the times and the other notes.
  const bedtimes = within(card).getByText('8pm')
  expect(emergency.compareDocumentPosition(bedtimes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  // Emergency notes are not repeated further down.
  expect(within(card).getAllByText('handoff.emergencyNotes')).toHaveLength(1)

  expect(card.textContent).not.toMatch(/\d{1,2}:\d{2}:\d{2}/)
  expect(card.textContent).toMatch(/(Fri|Sat)/)

  const links = within(card).getAllByRole('link')
  expect(links.map((link) => link.getAttribute('href'))).toEqual(['tel:5550100', 'tel:5550199'])
  expect(links[0].textContent).toBe('555-0100')
})

it('advises against putting alarm or door codes in the house notes', () => {
  expect(handoffEnglish.houseNotesPlaceholder).not.toMatch(/alarm code\.\.\.|TV codes/)
  expect(handoffEnglish.houseNotesPlaceholder).toMatch(/Don’t write alarm or door codes/)
  expect(handoffSpanish.houseNotesPlaceholder).toMatch(/No escribas aquí códigos de alarma/)
})
