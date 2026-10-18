/**
 * @jest-environment jsdom
 */
// Wishlist failures: no more window.alert with raw response text, and a
// network error no longer leaves the modal buttons stuck on "...".
import * as React from 'react'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
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
  mutationReply = async () =>
    ({ ok: true, status: 200, json: async () => ({}) }) as Response
  global.fetch = jest.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = (init?.method ?? 'GET').toUpperCase()
      if (url === '/api/auth/me') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ user: { id: 'u1', role: 'parent' } }),
        } as Response
      }
      if (url === '/api/wishlist' && method === 'GET') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [ITEM] }),
        } as Response
      }
      return mutationReply()
    },
  ) as unknown as typeof fetch
})

function renderPage() {
  return render(
    <ToastProvider>
      <WishlistPage />
    </ToastProvider>,
  )
}

const networkDown = async (): Promise<Response> => {
  throw new TypeError('Failed to fetch')
}

it("adding: shows the server's error field in the modal instead of alert()", async () => {
  mutationReply = async () =>
    ({
      ok: false,
      status: 400,
      text: async () => '{"error":"Title is required"}',
      json: async () => ({ error: 'Title is required' }),
    }) as Response
  const user = userEvent.setup()
  renderPage()
  await screen.findByText('Bike')
  await user.click(screen.getByRole('button', { name: /wishlist.addWish/ }))
  await user.type(screen.getByLabelText(/wishlist\.wishTitle/), 'Lego')
  await user.click(screen.getByRole('button', { name: 'wishlist.save' }))

  expect((await screen.findByRole('alert')).textContent).toBe(
    'wishlist.errorSave Title is required',
  )
  expect(window.alert).not.toHaveBeenCalled()
  expect(
    (screen.getByLabelText(/wishlist\.wishTitle/) as HTMLInputElement).value,
  ).toBe('Lego')
})

it('adding: rejects non-http links before sending the wishlist mutation', async () => {
  const user = userEvent.setup()
  renderPage()
  await screen.findByText('Bike')
  await user.click(screen.getByRole('button', { name: /wishlist.addWish/ }))
  await user.type(screen.getByLabelText(/wishlist\.wishTitle/), 'Lego')
  await user.type(
    screen.getByLabelText(/wishlist\.link/),
    'javascript:alert(1)',
  )
  await user.click(screen.getByRole('button', { name: 'wishlist.save' }))

  expect((await screen.findByRole('alert')).textContent).toBe(
    'wishlist.invalidLink',
  )
  expect(
    (global.fetch as jest.Mock).mock.calls.filter(
      ([input, init]) =>
        String(input) === '/api/wishlist' &&
        String(init?.method ?? 'GET').toUpperCase() === 'POST',
    ),
  ).toHaveLength(0)
})

it('deleting: a network error shows a message and the buttons work again', async () => {
  mutationReply = networkDown
  const user = userEvent.setup()
  renderPage()
  await screen.findByText('Bike')
  await user.click(screen.getByRole('button', { name: 'wishlist.deleteItem' }))
  const dialog = screen.getByRole('alertdialog')
  await user.click(
    within(dialog).getByRole('button', { name: 'wishlist.delete' }),
  )

  expect((await within(dialog).findByRole('alert')).textContent).toBe(
    'wishlist.writeUncertain',
  )
  expect(
    (
      within(dialog).getByRole('button', {
        name: 'wishlist.delete',
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false)
  expect(window.alert).not.toHaveBeenCalled()
})

it('renaming: a network error shows a message and the buttons work again', async () => {
  mutationReply = networkDown
  const user = userEvent.setup()
  renderPage()
  await screen.findByText('Bike')
  await user.click(screen.getByRole('button', { name: 'wishlist.editItem' }))
  const dialog = screen.getByRole('dialog')
  const input = within(dialog).getByLabelText(
    /wishlist.wishTitle/,
  ) as HTMLInputElement
  await user.clear(input)
  await user.type(input, 'Red bike')
  await user.click(
    within(dialog).getByRole('button', { name: 'wishlist.save' }),
  )

  expect((await within(dialog).findByRole('alert')).textContent).toBe(
    'wishlist.writeUncertain',
  )
  expect(
    (
      within(dialog).getByRole('button', {
        name: 'wishlist.save',
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false)
  expect(input.value).toBe('Red bike')
})

it('changing status: a failure shows an error toast instead of alert()', async () => {
  mutationReply = async () =>
    ({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Parents only' }),
    }) as Response
  const user = userEvent.setup()
  renderPage()
  await screen.findByText('Bike')
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'wishlist.statusFor' }),
    'received',
  )

  const toast = await screen.findByRole('alert')
  expect(toast.textContent).toContain('wishlist.errorStatus')
  expect(toast.textContent).toContain('Parents only')
  expect(window.alert).not.toHaveBeenCalled()
})

it('denying: uses a draft-preserving dialog instead of window.prompt', async () => {
  mutationReply = async () =>
    ({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Parents only' }),
    }) as Response
  const user = userEvent.setup()
  renderPage()
  await screen.findByText('Bike')
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'wishlist.statusFor' }),
    'denied',
  )

  const dialog = screen.getByRole('dialog', { name: 'wishlist.denyWish' })
  const reason = within(dialog).getByLabelText(
    'wishlist.deniedReason',
  ) as HTMLTextAreaElement
  await user.type(reason, 'It is no longer needed')
  await user.click(
    within(dialog).getByRole('button', { name: 'wishlist.confirmDenial' }),
  )

  expect((await within(dialog).findByRole('alert')).textContent).toBe(
    'Parents only',
  )
  expect(reason.value).toBe('It is no longer needed')
  expect(window.prompt).not.toHaveBeenCalled()
})

it('denying: restores focus to the triggering status select after a retry succeeds', async () => {
  let statusAttempts = 0
  let current = { ...ITEM, denied_reason: null as string | null }
  global.fetch = jest.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = (init?.method ?? 'GET').toUpperCase()
      if (url === '/api/auth/me') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ user: { id: 'u1', role: 'parent' } }),
        } as Response
      }
      if (url === '/api/wishlist' && method === 'GET') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [current] }),
        } as Response
      }
      if (url === '/api/wishlist/w1/status' && method === 'PATCH') {
        statusAttempts += 1
        if (statusAttempts === 1) {
          return {
            ok: false,
            status: 503,
            json: async () => ({ error: 'Unavailable' }),
          } as Response
        }
        current = {
          ...ITEM,
          status: 'denied',
          denied_reason: 'It is no longer needed',
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ item: current }),
        } as Response
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response
    },
  ) as unknown as typeof fetch

  const user = userEvent.setup()
  renderPage()
  await screen.findByText('Bike')
  const select = screen.getAllByRole('combobox', {
    name: 'wishlist.statusFor',
  })[0] as HTMLSelectElement
  await user.selectOptions(select, 'denied')

  const dialog = screen.getByRole('dialog', { name: 'wishlist.denyWish' })
  const reason = within(dialog).getByLabelText('wishlist.deniedReason')
  await user.type(reason, 'It is no longer needed')
  await user.click(
    within(dialog).getByRole('button', { name: 'wishlist.confirmDenial' }),
  )

  expect((await within(dialog).findByRole('alert')).textContent).toBe(
    'wishlist.statusUncertain',
  )
  expect((reason as HTMLTextAreaElement).value).toBe('It is no longer needed')

  await user.click(
    within(dialog).getByRole('button', { name: 'wishlist.confirmDenial' }),
  )
  await waitFor(() =>
    expect(
      screen.queryByRole('dialog', { name: 'wishlist.denyWish' }),
    ).toBeNull(),
  )
  await waitFor(() => expect(document.activeElement).toBe(select))
  expect(select.value).toBe('denied')
  expect(statusAttempts).toBe(2)
})

it('status changes lock one item while pending and ignore a second selection', async () => {
  let resolveStatus: (value: Response) => void = () => {}
  let statusCalls = 0
  let current = ITEM
  global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    if (url === '/api/auth/me') {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ user: { id: 'u1', role: 'parent' } }),
      } as Response)
    }
    if (url === '/api/wishlist' && method === 'GET') {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ items: [current] }),
      } as Response)
    }
    if (url === '/api/wishlist/w1/status' && method === 'PATCH') {
      statusCalls += 1
      return new Promise<Response>((resolve) => {
        resolveStatus = resolve
      })
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({}),
    } as Response)
  }) as unknown as typeof fetch

  const user = userEvent.setup()
  renderPage()
  await screen.findByText('Bike')
  const select = screen.getAllByRole('combobox', {
    name: 'wishlist.statusFor',
  })[0] as HTMLSelectElement
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
  global.fetch = jest.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = (init?.method ?? 'GET').toUpperCase()
      if (url === '/api/auth/me') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ user: { id: 'u1', role: 'parent' } }),
        } as Response
      }
      if (url === '/api/wishlist' && method === 'GET') {
        wishlistGets += 1
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [current] }),
        } as Response
      }
      if (url === '/api/wishlist/w1/status' && method === 'PATCH') {
        current = { ...ITEM, status: 'received' }
        return {
          ok: true,
          status: 200,
          json: async () => ({ unexpected: true }),
        } as Response
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response
    },
  ) as unknown as typeof fetch

  const user = userEvent.setup()
  renderPage()
  await screen.findByText('Bike')
  const select = screen.getByRole('combobox', {
    name: 'wishlist.statusFor',
  }) as HTMLSelectElement
  await user.selectOptions(select, 'received')

  await waitFor(() => expect(select.value).toBe('received'))
  expect(wishlistGets).toBe(2)
  expect(screen.queryByRole('alert')).toBeNull()
})

it('reconciles a network-uncertain status write before showing an error', async () => {
  let current = ITEM
  global.fetch = jest.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = (init?.method ?? 'GET').toUpperCase()
      if (url === '/api/auth/me') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ user: { id: 'u1', role: 'parent' } }),
        } as Response
      }
      if (url === '/api/wishlist' && method === 'GET') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [current] }),
        } as Response
      }
      if (url === '/api/wishlist/w1/status' && method === 'PATCH') {
        current = { ...ITEM, status: 'received' }
        throw new TypeError('Failed to fetch')
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response
    },
  ) as unknown as typeof fetch

  const user = userEvent.setup()
  renderPage()
  await screen.findByText('Bike')
  const select = screen.getByRole('combobox', {
    name: 'wishlist.statusFor',
  }) as HTMLSelectElement
  await user.selectOptions(select, 'received')

  await waitFor(() => expect(select.value).toBe('received'))
  expect(screen.queryByRole('alert')).toBeNull()
})

it('reconciles a 5xx status response before allowing a retry', async () => {
  let current = ITEM
  let wishlistGets = 0
  global.fetch = jest.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = (init?.method ?? 'GET').toUpperCase()
      if (url === '/api/auth/me') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ user: { id: 'u1', role: 'parent' } }),
        } as Response
      }
      if (url === '/api/wishlist' && method === 'GET') {
        wishlistGets += 1
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [current] }),
        } as Response
      }
      if (url === '/api/wishlist/w1/status' && method === 'PATCH') {
        current = { ...ITEM, status: 'received' }
        return {
          ok: false,
          status: 503,
          json: async () => ({ error: 'Unavailable' }),
        } as Response
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response
    },
  ) as unknown as typeof fetch

  const user = userEvent.setup()
  renderPage()
  await screen.findByText('Bike')
  const select = screen.getByRole('combobox', {
    name: 'wishlist.statusFor',
  }) as HTMLSelectElement
  await user.selectOptions(select, 'received')

  await waitFor(() => expect(select.value).toBe('received'))
  expect(wishlistGets).toBe(2)
  expect(screen.queryByRole('alert')).toBeNull()
})

it('keeps the confirmed PATCH status and offers a GET-only retry when refresh fails', async () => {
  const secondItem = { ...ITEM, id: 'w2', title: 'Ball' }
  let wishlistGets = 0
  const committed = { ...ITEM, status: 'received' as const }
  let statusCalls = 0
  const statusKeys: string[] = []
  global.fetch = jest.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = (init?.method ?? 'GET').toUpperCase()
      if (url === '/api/auth/me') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ user: { id: 'u1', role: 'parent' } }),
        } as Response
      }
      if (url === '/api/wishlist' && method === 'GET') {
        wishlistGets += 1
        if (wishlistGets === 2) throw new TypeError('Failed to fetch')
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [wishlistGets >= 3 ? committed : ITEM, secondItem],
          }),
        } as Response
      }
      if (url === '/api/wishlist/w1/status' && method === 'PATCH') {
        statusCalls += 1
        statusKeys.push(
          String(
            init?.headers && new Headers(init.headers).get('Idempotency-Key'),
          ),
        )
        return {
          ok: true,
          status: 200,
          json: async () => ({ item: committed }),
        } as Response
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response
    },
  ) as unknown as typeof fetch

  const user = userEvent.setup()
  renderPage()
  await screen.findByText('Bike')
  const select = screen.getAllByRole('combobox', {
    name: 'wishlist.statusFor',
  })[0] as HTMLSelectElement
  await user.selectOptions(select, 'received')

  await waitFor(() => expect(select.value).toBe('received'))
  expect(screen.getByText('Ball')).toBeTruthy()
  expect((await screen.findByRole('alert')).textContent).toContain(
    'wishlist.statusSavedRefreshFailed',
  )
  expect(wishlistGets).toBe(2)
  expect(statusCalls).toBe(1)
  expect(statusKeys[0]).toBeTruthy()

  await user.click(screen.getByRole('button', { name: 'wishlist.retry' }))
  await waitFor(() =>
    expect(screen.queryByText('wishlist.statusSavedRefreshFailed')).toBeNull(),
  )
  expect(wishlistGets).toBe(3)
  expect(statusCalls).toBe(1)
})

it('keeps a malformed status payload unresolved when reconciliation also fails', async () => {
  let wishlistGets = 0
  global.fetch = jest.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = (init?.method ?? 'GET').toUpperCase()
      if (url === '/api/auth/me') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ user: { id: 'u1', role: 'parent' } }),
        } as Response
      }
      if (url === '/api/wishlist' && method === 'GET') {
        wishlistGets += 1
        if (wishlistGets === 1) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ items: [ITEM] }),
          } as Response
        }
        throw new TypeError('Failed to fetch')
      }
      if (url === '/api/wishlist/w1/status' && method === 'PATCH') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            item: { id: 'w1', status: 'received', denied_reason: null },
          }),
        } as Response
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response
    },
  ) as unknown as typeof fetch

  const user = userEvent.setup()
  renderPage()
  await screen.findByText('Bike')
  const select = screen.getByRole('combobox', {
    name: 'wishlist.statusFor',
  }) as HTMLSelectElement
  await user.selectOptions(select, 'received')

  await waitFor(() => expect(select.value).toBe('idle'))
  expect((await screen.findByRole('alert')).textContent).toContain(
    'wishlist.statusUncertain',
  )
  expect(wishlistGets).toBe(2)
})

it('does not let an older status refresh overwrite a newer item refresh', async () => {
  const secondItem = { ...ITEM, id: 'w2', title: 'Ball' }
  const refreshes: Array<(items: unknown[]) => void> = []
  let wishlistGets = 0
  global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    if (url === '/api/auth/me') {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ user: { id: 'u1', role: 'parent' } }),
      } as Response)
    }
    if (url === '/api/wishlist' && method === 'GET') {
      wishlistGets += 1
      if (wishlistGets === 1) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ items: [ITEM, secondItem] }),
        } as Response)
      }
      return new Promise<Response>((resolve) => {
        refreshes.push((items) =>
          resolve({
            ok: true,
            status: 200,
            json: async () => ({ items }),
          } as Response),
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
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({}),
    } as Response)
  }) as unknown as typeof fetch

  const user = userEvent.setup()
  renderPage()
  await screen.findByText('Bike')
  const [bikeSelect, ballSelect] = screen.getAllByRole('combobox', {
    name: 'wishlist.statusFor',
  }) as HTMLSelectElement[]

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
  refreshes[0]([{ ...ITEM, status: 'received' }, secondItem])
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(ballSelect.value).toBe('on_the_way')
})

it('keeps a confirmed add visible when refresh fails and retries only the GET', async () => {
  let wishlistGets = 0
  let addCalls = 0
  const created = {
    ...ITEM,
    id: 'w-created',
    title: 'Tent',
    link: null,
  }
  global.fetch = jest.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = (init?.method ?? 'GET').toUpperCase()
      if (url === '/api/auth/me') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ user: { id: 'u1', role: 'parent' } }),
        } as Response
      }
      if (url === '/api/wishlist' && method === 'GET') {
        wishlistGets += 1
        if (wishlistGets === 2) throw new TypeError('Refresh failed')
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: wishlistGets >= 3 ? [ITEM, created] : [ITEM],
          }),
        } as Response
      }
      if (url === '/api/wishlist' && method === 'POST') {
        addCalls += 1
        return {
          ok: true,
          status: 201,
          json: async () => ({ item: created }),
        } as Response
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response
    },
  ) as unknown as typeof fetch

  const user = userEvent.setup()
  renderPage()
  await screen.findByText('Bike')
  await user.click(screen.getByRole('button', { name: /wishlist.addWish/ }))
  await user.type(screen.getByLabelText(/wishlist\.wishTitle/), 'Tent')
  await user.click(screen.getByRole('button', { name: 'wishlist.save' }))

  await waitFor(() => expect(screen.getByText('Tent')).toBeTruthy())
  expect(screen.getByText('wishlist.savedRefreshFailed')).toBeTruthy()
  expect(addCalls).toBe(1)

  await user.click(screen.getByRole('button', { name: 'wishlist.retry' }))
  await waitFor(() =>
    expect(screen.queryByText('wishlist.savedRefreshFailed')).toBeNull(),
  )
  expect(wishlistGets).toBe(3)
  expect(screen.getByText('Tent')).toBeTruthy()
})

it('reuses the same mutation key when an add is retried with the same draft', async () => {
  let postAttempts = 0
  const keys: string[] = []
  const created = { ...ITEM, id: 'w-retried', title: 'Helmet' }
  global.fetch = jest.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = (init?.method ?? 'GET').toUpperCase()
      if (url === '/api/auth/me') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ user: { id: 'u1', role: 'parent' } }),
        } as Response
      }
      if (url === '/api/wishlist' && method === 'GET') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [ITEM] }),
        } as Response
      }
      if (url === '/api/wishlist' && method === 'POST') {
        keys.push(
          String(
            init?.headers && new Headers(init.headers).get('Idempotency-Key'),
          ),
        )
        postAttempts += 1
        if (postAttempts === 1) throw new TypeError('Lost response')
        return {
          ok: true,
          status: 201,
          json: async () => ({ item: created }),
        } as Response
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response
    },
  ) as unknown as typeof fetch

  const user = userEvent.setup()
  renderPage()
  await screen.findByText('Bike')
  await user.click(screen.getByRole('button', { name: /wishlist.addWish/ }))
  await user.type(screen.getByLabelText(/wishlist\.wishTitle/), 'Helmet')
  const save = screen.getByRole('button', { name: 'wishlist.save' })
  await user.click(save)
  expect((await screen.findByRole('alert')).textContent).toContain(
    'wishlist.writeUncertain',
  )
  await user.click(screen.getByRole('button', { name: 'wishlist.save' }))
  await waitFor(() => expect(screen.getByText('Helmet')).toBeTruthy())
  expect(keys).toHaveLength(2)
  expect(keys[0]).toBe(keys[1])
})

it('keeps an add intent across retryable 409 and 429 responses', async () => {
  let attempts = 0
  const keys: string[] = []
  const created = { ...ITEM, id: 'w-retryable', title: 'Skates' }
  global.fetch = jest.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = (init?.method ?? 'GET').toUpperCase()
      if (url === '/api/auth/me') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ user: { id: 'u1', role: 'parent' } }),
        } as Response
      }
      if (url === '/api/wishlist' && method === 'GET') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: attempts >= 3 ? [ITEM, created] : [ITEM] }),
        } as Response
      }
      if (url === '/api/wishlist' && method === 'POST') {
        attempts += 1
        keys.push(
          String(
            init?.headers && new Headers(init.headers).get('Idempotency-Key'),
          ),
        )
        if (attempts === 1) {
          return {
            ok: false,
            status: 409,
            json: async () => ({
              error: {
                code: 'IDEMPOTENCY_IN_PROGRESS',
                message: 'Still processing',
                retryable: true,
              },
            }),
          } as Response
        }
        if (attempts === 2) {
          return {
            ok: false,
            status: 429,
            json: async () => ({ error: 'Rate limited' }),
          } as Response
        }
        return {
          ok: true,
          status: 201,
          json: async () => ({ item: created }),
        } as Response
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response
    },
  ) as unknown as typeof fetch

  const user = userEvent.setup()
  renderPage()
  await screen.findByText('Bike')
  await user.click(screen.getByRole('button', { name: /wishlist.addWish/ }))
  await user.type(screen.getByLabelText(/wishlist\.wishTitle/), 'Skates')
  const save = screen.getByRole('button', { name: 'wishlist.save' })

  await user.click(save)
  expect((await screen.findByRole('alert')).textContent).toContain(
    'wishlist.writeUncertain',
  )
  await user.click(save)
  expect((await screen.findByRole('alert')).textContent).toContain(
    'wishlist.writeUncertain',
  )
  await user.click(save)
  await waitFor(() => expect(screen.getByText('Skates')).toBeTruthy())
  expect(keys).toHaveLength(3)
  expect(new Set(keys).size).toBe(1)
})

it('rejects a successful edit response with the wrong identity or edited fields', async () => {
  let attempts = 0
  const keys: string[] = []
  global.fetch = jest.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = (init?.method ?? 'GET').toUpperCase()
      if (url === '/api/auth/me') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ user: { id: 'u1', role: 'parent' } }),
        } as Response
      }
      if (url === '/api/wishlist' && method === 'GET') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [ITEM] }),
        } as Response
      }
      if (url === '/api/wishlist/w1' && method === 'PATCH') {
        attempts += 1
        keys.push(
          String(
            init?.headers && new Headers(init.headers).get('Idempotency-Key'),
          ),
        )
        if (attempts === 1) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              item: {
                ...ITEM,
                title: 'Wrong server item',
                requested_by: 'other-user',
                requester: { id: 'other-user', name: 'Other' },
              },
            }),
          } as Response
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ item: { ...ITEM, title: 'Red bike' } }),
        } as Response
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response
    },
  ) as unknown as typeof fetch

  const user = userEvent.setup()
  renderPage()
  await screen.findByText('Bike')
  await user.click(screen.getByRole('button', { name: 'wishlist.editItem' }))
  const dialog = screen.getByRole('dialog')
  const title = within(dialog).getByLabelText(/wishlist\.wishTitle/)
  await user.clear(title)
  await user.type(title, 'Red bike')
  const save = within(dialog).getByRole('button', { name: 'wishlist.save' })

  await user.click(save)
  expect((await within(dialog).findByRole('alert')).textContent).toContain(
    'wishlist.writeUncertain',
  )
  expect(screen.queryByText('Wrong server item')).toBeNull()
  await user.click(save)
  await waitFor(() => expect(screen.getByText('Red bike')).toBeTruthy())
  expect(keys).toHaveLength(2)
  expect(keys[0]).toBe(keys[1])
})

it('shows a child only their own ideas and keeps parent status controls private', async () => {
  const own = {
    ...ITEM,
    id: 'w-child',
    title: 'Child bike',
    requested_by: 'u-child',
    requester: { id: 'u-child', name: 'Cameron' },
  }
  const familyWish = { ...ITEM, id: 'w-parent', title: 'Parent camera' }
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url === '/api/auth/me') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ user: { id: 'u-child', role: 'child' } }),
      } as Response
    }
    if (url === '/api/wishlist') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ items: [own, familyWish] }),
      } as Response
    }
    return { ok: true, status: 200, json: async () => ({}) } as Response
  }) as unknown as typeof fetch

  renderPage()
  await screen.findByText('Child bike')
  expect(screen.queryByText('Parent camera')).toBeNull()
  expect(screen.queryByRole('combobox')).toBeNull()
  expect(screen.getByRole('button', { name: 'wishlist.editItem' })).toBeTruthy()
  expect(
    screen.getByRole('button', { name: 'wishlist.deleteItem' }),
  ).toBeTruthy()
})

it('groups parent ideas by requester id even when names are identical', async () => {
  const first = {
    ...ITEM,
    id: 'w-first',
    title: 'First idea',
    requested_by: 'u-first',
    requester: { id: 'u-first', name: 'Alex' },
  }
  const second = {
    ...ITEM,
    id: 'w-second',
    title: 'Second idea',
    requested_by: 'u-second',
    requester: { id: 'u-second', name: 'Alex' },
  }
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url === '/api/auth/me') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ user: { id: 'u1', role: 'parent' } }),
      } as Response
    }
    if (url === '/api/wishlist') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ items: [first, second] }),
      } as Response
    }
    return { ok: true, status: 200, json: async () => ({}) } as Response
  }) as unknown as typeof fetch

  renderPage()
  await screen.findByText('First idea')
  const regions = screen.getAllByRole('region')
  expect(regions).toHaveLength(2)
  expect(
    new Set(regions.map((region) => region.getAttribute('aria-labelledby'))).size,
  ).toBe(2)
})

it('uses the personal ideas heading for teen members', async () => {
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url === '/api/auth/me') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ user: { id: 'u-teen', role: 'teen' } }),
      } as Response
    }
    if (url === '/api/wishlist') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            {
              ...ITEM,
              id: 'w-teen',
              requested_by: 'u-teen',
              requester: { id: 'u-teen', name: 'Teen' },
            },
          ],
        }),
      } as Response
    }
    return { ok: true, status: 200, json: async () => ({}) } as Response
  }) as unknown as typeof fetch

  renderPage()
  await screen.findByText('Bike')
  expect(
    screen.getByRole('heading', { level: 1, name: 'wishlist.myIdeas' }),
  ).toBeTruthy()
  expect(
    screen.queryByRole('heading', { name: 'wishlist.familyTitle' }),
  ).toBeNull()
})

it('editing: sends the existing wishlist fields through the short sheet', async () => {
  let current = {
    ...ITEM,
    link: null as string | null,
    description: null as string | null,
    approx_price: null as string | null,
  }
  let patchBody: Record<string, unknown> | null = null
  global.fetch = jest.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = (init?.method ?? 'GET').toUpperCase()
      if (url === '/api/auth/me') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ user: { id: 'u1', role: 'parent' } }),
        } as Response
      }
      if (url === '/api/wishlist' && method === 'GET') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [current] }),
        } as Response
      }
      if (url === '/api/wishlist/w1' && method === 'PATCH') {
        patchBody = JSON.parse(String(init?.body)) as Record<string, unknown>
        current = {
          ...current,
          title: String(patchBody.title),
          link: String(patchBody.link),
          description: String(patchBody.description),
          approx_price: String(patchBody.approx_price),
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ item: current }),
        } as Response
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response
    },
  ) as unknown as typeof fetch

  const user = userEvent.setup()
  renderPage()
  await screen.findByText('Bike')
  await user.click(screen.getByRole('button', { name: 'wishlist.editItem' }))
  const dialog = screen.getByRole('dialog')
  const title = within(dialog).getByLabelText(/wishlist\.wishTitle/)
  await user.clear(title)
  await user.type(title, 'Helmet')
  await user.type(
    within(dialog).getByLabelText(/wishlist\.link/),
    'https://example.test/helmet',
  )
  await user.type(
    within(dialog).getByLabelText(/wishlist\.description/),
    'A safe commuter helmet',
  )
  await user.type(
    within(dialog).getByLabelText(/wishlist\.approxPrice/),
    '42.50',
  )
  await user.click(
    within(dialog).getByRole('button', { name: 'wishlist.save' }),
  )

  await waitFor(() => expect(screen.getByText('Helmet')).toBeTruthy())
  expect(patchBody).toEqual({
    title: 'Helmet',
    link: 'https://example.test/helmet',
    description: 'A safe commuter helmet',
    approx_price: '42.5',
  })
})
