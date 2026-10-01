/**
 * @jest-environment jsdom
 */
// The public sitter page's print stylesheet shows only `.print-card`; the
// handoff content must carry that class or the printout is blank.
import * as React from 'react'
import { render, screen } from '@testing-library/react'

const mockT = (key: string) => key
jest.mock('@/i18n', () => ({ useTranslation: () => ({ t: mockT }) }))

import { HandoffClient } from '../HandoffClient'

beforeEach(() => {
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      handoff: {
        id: 'h1',
        sitter_name: 'Sarah',
        sitter_phone: null,
        arrival_time: null,
        departure_time: null,
        kids_bedtimes: '8pm',
        where_snacks: null,
        pickup_authorized: null,
        code_words: null,
        pet_care: null,
        emergency_notes: null,
        house_notes: null,
        general_notes: null,
        family: { name: 'Smith' },
      },
    }),
  })) as unknown as typeof fetch
})

it('wraps the handoff content in the print card', async () => {
  render(<HandoffClient token="tok" />)
  const sitter = await screen.findByText('Sarah')
  const card = screen.getByTestId('handoff-print-card')
  expect(card.classList.contains('print-card')).toBe(true)
  expect(card.contains(sitter)).toBe(true)
  expect(card.textContent).toContain('8pm')
  const print = screen.getByRole('button', { name: /handoff.print/ })
  expect(print.className).toMatch(/min-h-\[44px\]/)
})
