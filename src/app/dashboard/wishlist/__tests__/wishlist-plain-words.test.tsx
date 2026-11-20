/**
 * @jest-environment jsdom
 */
// UI review: friendly status labels ("Wished for", "Not this time" instead of
// "Idle"/"Denied"; stored values unchanged), a price with a currency symbol
// ("Approx. $18.00", not "Approx. 18") and no "All wishes loaded." line.
import * as React from 'react'
import { render, screen, within } from '@testing-library/react'
import { ToastProvider } from '@/components/ui/toast'
import { I18nProvider, messages } from '@/i18n'

jest.mock('@/components/ui/feature-gate', () => ({
  FeatureGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

import WishlistPage from '../page'

const ITEM = {
  id: 'w1',
  title: 'Bike',
  link: null,
  description: null,
  approx_price: '18',
  status: 'idle',
  denied_reason: null,
  requested_by: 'u2',
  created_at: '2026-09-01T00:00:00Z',
  requester: { id: 'u2', name: 'Pat' },
}

beforeEach(() => {
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'https://fixture.invalid').pathname
    if (url === '/api/auth/me')
      return { ok: true, status: 200, json: async () => ({ user: { id: 'u1', role: 'parent' } }) } as Response
    return { ok: true, status: 200, json: async () => ({ items: [ITEM], nextCursor: null }) } as Response
  }) as unknown as typeof fetch
})

it('uses friendly status words but keeps the stored values', () => {
  expect(messages.en.wishlist.status.idle).toBe('Wished for')
  expect(messages.en.wishlist.status.denied).toBe('Not this time')
  expect(messages.es.wishlist.status.idle).toBe('Deseado')
  expect(messages.es.wishlist.status.denied).toBe('Esta vez no')
})

it('shows the friendly labels, a money price and no loaded line', async () => {
  render(
    <I18nProvider locale="en">
      <ToastProvider>
        <WishlistPage />
      </ToastProvider>
    </I18nProvider>,
  )
  await screen.findByText('Bike')
  const select = screen.getByRole('combobox', { name: /Bike/ }) as HTMLSelectElement
  expect(select.value).toBe('idle')
  const options = within(select).getAllByRole('option').map((o) => [(o as HTMLOptionElement).value, o.textContent])
  expect(options).toEqual(expect.arrayContaining([['idle', 'Wished for'], ['denied', 'Not this time']]))
  expect(screen.queryByText('Idle')).toBeNull()
  expect(screen.queryByText('Denied')).toBeNull()
  expect(screen.getByText('Approx. $18.00')).toBeTruthy()
  expect(screen.getByText('All wishes loaded.').className).toContain('sr-only')
})
