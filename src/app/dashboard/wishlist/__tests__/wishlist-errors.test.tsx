/**
 * @jest-environment jsdom
 */
// Wishlist failures: no more window.alert with raw response text, and a
// network error no longer leaves the modal buttons stuck on "...".
import * as React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
  window.prompt = jest.fn()
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

it('denying: uses a draft-preserving dialog instead of window.prompt', async () => {
  mutationReply = async () =>
    ({ ok: false, status: 403, json: async () => ({ error: 'Parents only' }) }) as Response
  const user = userEvent.setup()
  renderPage()
  await screen.findByText('Bike')
  await user.selectOptions(screen.getByRole('combobox', { name: 'Status for Bike' }), 'denied')

  const dialog = screen.getByRole('dialog', { name: 'wishlist.denyWish' })
  const reason = within(dialog).getByLabelText('wishlist.deniedReason') as HTMLTextAreaElement
  await user.type(reason, 'It is no longer needed')
  await user.click(within(dialog).getByRole('button', { name: 'wishlist.confirmDenial' }))

  expect((await within(dialog).findByRole('alert')).textContent).toBe('Parents only')
  expect(reason.value).toBe('It is no longer needed')
  expect(window.prompt).not.toHaveBeenCalled()
})

it('status changes lock one item while pending and ignore a second selection', async () => {
  let resolveStatus: (value: Response) => void = () => {}
  let statusCalls = 0
  let current = ITEM
  global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    if (url === '/api/auth/me') {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ user: { id: 'u1', role: 'parent' } }) } as Response)
    }
    if (url === '/api/wishlist' && method === 'GET') {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ items: [current] }) } as Response)
    }
    if (url === '/api/wishlist/w1/status' && method === 'PATCH') {
      statusCalls += 1
      return new Promise<Response>((resolve) => {
        resolveStatus = resolve
      })
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response)
  }) as unknown as typeof fetch

  const user = userEvent.setup()
  renderPage()
  await screen.findByText('Bike')
  const select = screen.getByRole('combobox', { name: 'Status for Bike' }) as HTMLSelectElement
  await user.selectOptions(select, 'received')
  expect(select.disabled).toBe(true)
  fireEvent.change(select, { target: { value: 'idle' } })
  expect(statusCalls).toBe(1)

  current = { ...ITEM, status: 'received' }
  resolveStatus({
    ok: true,
    status: 200,
    json: async () => ({ item: current }),
  } as Response)
  await waitFor(() => expect(select.disabled).toBe(false))
  expect(select.value).toBe('received')
})

it('reconciles a malformed status response before allowing a retry', async () => {
  let wishlistGets = 0
  let current = ITEM
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    if (url === '/api/auth/me') {
      return { ok: true, status: 200, json: async () => ({ user: { id: 'u1', role: 'parent' } }) } as Response
    }
    if (url === '/api/wishlist' && method === 'GET') {
      wishlistGets += 1
      return { ok: true, status: 200, json: async () => ({ items: [current] }) } as Response
    }
    if (url === '/api/wishlist/w1/status' && method === 'PATCH') {
      current = { ...ITEM, status: 'received' }
      return { ok: true, status: 200, json: async () => ({ unexpected: true }) } as Response
    }
    return { ok: true, status: 200, json: async () => ({}) } as Response
  }) as unknown as typeof fetch

  const user = userEvent.setup()
  renderPage()
  await screen.findByText('Bike')
  const select = screen.getByRole('combobox', { name: 'Status for Bike' }) as HTMLSelectElement
  await user.selectOptions(select, 'received')

  await waitFor(() => expect(select.value).toBe('received'))
  expect(wishlistGets).toBe(2)
  expect(screen.queryByRole('alert')).toBeNull()
})

it('reconciles a network-uncertain status write before showing an error', async () => {
  let current = ITEM
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    if (url === '/api/auth/me') {
      return { ok: true, status: 200, json: async () => ({ user: { id: 'u1', role: 'parent' } }) } as Response
    }
    if (url === '/api/wishlist' && method === 'GET') {
      return { ok: true, status: 200, json: async () => ({ items: [current] }) } as Response
    }
    if (url === '/api/wishlist/w1/status' && method === 'PATCH') {
      current = { ...ITEM, status: 'received' }
      throw new TypeError('Failed to fetch')
    }
    return { ok: true, status: 200, json: async () => ({}) } as Response
  }) as unknown as typeof fetch

  const user = userEvent.setup()
  renderPage()
  await screen.findByText('Bike')
  const select = screen.getByRole('combobox', { name: 'Status for Bike' }) as HTMLSelectElement
  await user.selectOptions(select, 'received')

  await waitFor(() => expect(select.value).toBe('received'))
  expect(screen.queryByRole('alert')).toBeNull()
})

it('reconciles a 5xx status response before allowing a retry', async () => {
  let current = ITEM
  let wishlistGets = 0
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    if (url === '/api/auth/me') {
      return { ok: true, status: 200, json: async () => ({ user: { id: 'u1', role: 'parent' } }) } as Response
    }
    if (url === '/api/wishlist' && method === 'GET') {
      wishlistGets += 1
      return { ok: true, status: 200, json: async () => ({ items: [current] }) } as Response
    }
    if (url === '/api/wishlist/w1/status' && method === 'PATCH') {
      current = { ...ITEM, status: 'received' }
      return { ok: false, status: 503, json: async () => ({ error: 'Unavailable' }) } as Response
    }
    return { ok: true, status: 200, json: async () => ({}) } as Response
  }) as unknown as typeof fetch

  const user = userEvent.setup()
  renderPage()
  await screen.findByText('Bike')
  const select = screen.getByRole('combobox', { name: 'Status for Bike' }) as HTMLSelectElement
  await user.selectOptions(select, 'received')

  await waitFor(() => expect(select.value).toBe('received'))
  expect(wishlistGets).toBe(2)
  expect(screen.queryByRole('alert')).toBeNull()
})

it('does not let an older status refresh overwrite a newer item refresh', async () => {
  const secondItem = { ...ITEM, id: 'w2', title: 'Ball' }
  const refreshes: Array<(items: unknown[]) => void> = []
  let wishlistGets = 0
  global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    if (url === '/api/auth/me') {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ user: { id: 'u1', role: 'parent' } }) } as Response)
    }
    if (url === '/api/wishlist' && method === 'GET') {
      wishlistGets += 1
      if (wishlistGets === 1) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ items: [ITEM, secondItem] }) } as Response)
      }
      return new Promise<Response>((resolve) => {
        refreshes.push((items) =>
          resolve({ ok: true, status: 200, json: async () => ({ items }) } as Response),
        )
      })
    }
    if (url === '/api/wishlist/w1/status' && method === 'PATCH') {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ item: { ...ITEM, status: 'received' } }),
      } as Response)
    }
    if (url === '/api/wishlist/w2/status' && method === 'PATCH') {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ item: { ...secondItem, status: 'on_the_way' } }),
      } as Response)
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response)
  }) as unknown as typeof fetch

  const user = userEvent.setup()
  renderPage()
  await screen.findByText('Bike')
  const bikeSelect = screen.getByRole('combobox', { name: 'Status for Bike' }) as HTMLSelectElement
  const ballSelect = screen.getByRole('combobox', { name: 'Status for Ball' }) as HTMLSelectElement

  await user.selectOptions(bikeSelect, 'received')
  await waitFor(() => expect(refreshes).toHaveLength(1))
  await user.selectOptions(ballSelect, 'on_the_way')
  await waitFor(() => expect(refreshes).toHaveLength(2))

  // The newer refresh resolves first with both committed statuses. The older
  // response is deliberately stale and must not replace it afterward.
  refreshes[1]([
    { ...ITEM, status: 'received' },
    { ...secondItem, status: 'on_the_way' },
  ])
  await waitFor(() => expect(ballSelect.value).toBe('on_the_way'))
  refreshes[0]([
    { ...ITEM, status: 'received' },
    secondItem,
  ])
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(ballSelect.value).toBe('on_the_way')
})
