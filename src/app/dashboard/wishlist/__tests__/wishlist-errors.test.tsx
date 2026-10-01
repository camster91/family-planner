/**
 * @jest-environment jsdom
 */
// Wishlist failures: no more window.alert with raw response text, and a
// network error no longer leaves the modal buttons stuck on "...".
import * as React from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastProvider } from '@/components/ui/toast'

const mockT = (key: string) => key
jest.mock('@/i18n', () => ({ useTranslation: () => ({ t: mockT }) }))
jest.mock('@/components/ui/feature-gate', () => ({
  FeatureGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

import WishlistPage from '../page'

const ITEM = {
  id: 'w1',
  title: 'Bike',
  link: null,
  description: null,
  approx_price: null,
  status: 'idle',
  denied_reason: null,
  requested_by: 'u1',
  created_at: '2026-09-01T00:00:00Z',
  requester: { id: 'u1', name: 'Pat' },
}

let mutationReply: () => Promise<Response>

beforeEach(() => {
  window.alert = jest.fn()
  mutationReply = async () => ({ ok: true, status: 200, json: async () => ({}) }) as Response
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    if (url === '/api/auth/me') {
      return { ok: true, status: 200, json: async () => ({ user: { id: 'u1', role: 'parent' } }) } as Response
    }
    if (url === '/api/wishlist' && method === 'GET') {
      return { ok: true, status: 200, json: async () => ({ items: [ITEM] }) } as Response
    }
    return mutationReply()
  }) as unknown as typeof fetch
})

function renderPage() {
  return render(
    <ToastProvider>
      <WishlistPage />
    </ToastProvider>
  )
}

const networkDown = async (): Promise<Response> => {
  throw new TypeError('Failed to fetch')
}

it("adding: shows the server's error field in the modal instead of alert()", async () => {
  mutationReply = async () =>
    ({ ok: false, status: 400, text: async () => '{"error":"Title is required"}', json: async () => ({ error: 'Title is required' }) }) as Response
  const user = userEvent.setup()
  renderPage()
  await screen.findByText('Bike')
  await user.click(screen.getByRole('button', { name: /wishlist.addWish/ }))
  await user.type(screen.getByPlaceholderText('Nintendo Switch'), 'Lego')
  await user.click(screen.getByRole('button', { name: 'wishlist.save' }))

  expect((await screen.findByRole('alert')).textContent).toBe('wishlist.errorSave Title is required')
  expect(window.alert).not.toHaveBeenCalled()
  expect((screen.getByPlaceholderText('Nintendo Switch') as HTMLInputElement).value).toBe('Lego')
})

it('deleting: a network error shows a message and the buttons work again', async () => {
  mutationReply = networkDown
  const user = userEvent.setup()
  renderPage()
  await screen.findByText('Bike')
  await user.click(screen.getByTitle('wishlist.delete'))
  const dialog = screen.getByRole('alertdialog')
  await user.click(within(dialog).getByRole('button', { name: 'wishlist.delete' }))

  expect((await within(dialog).findByRole('alert')).textContent).toBe('wishlist.errorDelete common.networkError')
  expect((within(dialog).getByRole('button', { name: 'wishlist.delete' }) as HTMLButtonElement).disabled).toBe(false)
  expect(window.alert).not.toHaveBeenCalled()
})

it('renaming: a network error shows a message and the buttons work again', async () => {
  mutationReply = networkDown
  const user = userEvent.setup()
  renderPage()
  await screen.findByText('Bike')
  await user.click(screen.getByTitle('wishlist.edit'))
  const dialog = screen.getByRole('dialog')
  const input = within(dialog).getByLabelText(/wishlist.wishTitle/) as HTMLInputElement
  await user.clear(input)
  await user.type(input, 'Red bike')
  await user.click(within(dialog).getByRole('button', { name: 'wishlist.save' }))

  expect((await within(dialog).findByRole('alert')).textContent).toBe('wishlist.errorSave common.networkError')
  expect((within(dialog).getByRole('button', { name: 'wishlist.save' }) as HTMLButtonElement).disabled).toBe(false)
  expect(input.value).toBe('Red bike')
})

it('changing status: a failure shows an error toast instead of alert()', async () => {
  mutationReply = async () => ({ ok: false, status: 403, json: async () => ({ error: 'Parents only' }) }) as Response
  const user = userEvent.setup()
  renderPage()
  await screen.findByText('Bike')
  await user.selectOptions(screen.getByRole('combobox', { name: 'Status for Bike' }), 'received')

  const toast = await screen.findByRole('alert')
  expect(toast.textContent).toContain('wishlist.errorStatus')
  expect(toast.textContent).toContain('Parents only')
  expect(window.alert).not.toHaveBeenCalled()
})
