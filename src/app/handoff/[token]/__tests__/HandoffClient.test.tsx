/**
 * @jest-environment jsdom
 */
// The public sitter page's print stylesheet shows only `.print-card`; the
// handoff content must carry that class or the printout is blank.
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

let mockLocale = 'en'
const mockT = (
  key: string,
  params?: Record<string, string | number>,
  scoped?: Record<string, Record<string, string>>,
) => {
  const base: Record<string, string> = {
    'routeState.tryAgain': mockLocale === 'es' ? 'Intentar de nuevo' : 'Try again',
  }
  const message = scoped?.[mockLocale]?.[key] ?? base[key] ?? key
  return message.replace(/\{(\w+)\}/g, (_, name) => String(params?.[name] ?? `{${name}}`))
}
jest.mock('@/i18n', () => ({
  useTranslation: () => ({
    locale: mockLocale,
    t: (key: string, params?: Record<string, string | number>, scoped?: Record<string, Record<string, string>>) =>
      mockT(key, params, scoped),
  }),
}))

import { HandoffClient } from '../HandoffClient'

beforeEach(() => {
  mockLocale = 'en'
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

it('separates a transient share failure from an invalid link and retries it', async () => {
  const user = userEvent.setup()
  let attempts = 0
  const successfulBody = {
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
  }
  global.fetch = jest.fn(async () => {
    attempts += 1
    if (attempts === 1) return { ok: false, status: 503, json: async () => ({ error: 'temporary' }) } as Response
    return { ok: true, status: 200, json: async () => successfulBody } as Response
  }) as unknown as typeof fetch

  render(<HandoffClient token="tok" />)
  expect(await screen.findByRole('heading', { name: 'This handoff could not be loaded' })).toBeTruthy()
  expect(screen.queryByText('handoff.linkInvalid')).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByText('Sarah')).toBeTruthy()
  expect(attempts).toBe(2)
})

it('localizes transient share recovery in Spanish', async () => {
  mockLocale = 'es'
  global.fetch = jest.fn(async () => ({
    ok: false,
    status: 503,
    json: async () => ({ error: 'temporary' }),
  })) as unknown as typeof fetch

  render(<HandoffClient token="tok" />)
  expect(await screen.findByRole('heading', { name: 'No se pudo cargar esta entrega' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Intentar de nuevo' })).toBeTruthy()
  expect(screen.queryByText('handoff.linkInvalid')).toBeNull()
})
