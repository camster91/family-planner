/**
 * @jest-environment jsdom
 */
// Undo over confirm (#269): deleting a list item happens at once and Undo
// re-creates it; an ambiguous response stays held until exact status is known.
import * as React from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ListDetailClient from '../ListDetailClient'
import { ToastProvider } from '@/components/ui/toast'

const mockSetChecked = jest.fn(async () => {})
const mockDiscard = jest.fn(async () => {})
const mockRefresh = jest.fn()
// Queued offline ticks by item id (#162): the visible state, not the server's.
const mockQueued = new Map<string, boolean>()
jest.mock('../use-list-item-sync', () => ({
  __emptyOperations: Object.freeze([]),
  useListItemSync: () => ({
    operations: require('../use-list-item-sync').__emptyOperations,
    online: true,
    durable: true,
    pendingCount: 0,
    notice: null,
    dismissNotice: () => {},
    stateFor: (id: string) =>
      mockQueued.has(id)
        ? {
            id: `op-${id}`,
            state: 'failed',
            payload: { itemId: id, checked: mockQueued.get(id) },
          }
        : undefined,
    setChecked: mockSetChecked,
    retry: async () => {},
    discard: mockDiscard,
  }),
}))
// The swipe gesture itself needs pointer capture, which jsdom lacks; expose
// the swipe action as a button so the delete path can be driven.
jest.mock('@/components/ui/swipe-row', () => ({
  SwipeRow: ({
    children,
    onSwipeLeft,
  }: {
    children: React.ReactNode
    onSwipeLeft?: () => void
  }) => (
    <div>
      {children}
      {onSwipeLeft && (
        <button type="button" onClick={onSwipeLeft}>
          Swipe to delete
        </button>
      )}
    </div>
  ),
}))

type Call = { url: string; method: string; body: unknown }
let calls: Call[] = []
let deleteStatus = 200
let deleteThrows = false
let reconcileState: 'found' | 'missing' | 'held' = 'held'

beforeEach(() => {
  calls = []
  deleteStatus = 200
  deleteThrows = false
  reconcileState = 'held'
  mockSetChecked.mockClear()
  mockDiscard.mockClear()
  mockRefresh.mockClear()
  mockQueued.clear()
  window.confirm = jest.fn(() => false)
  global.fetch = jest.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = (init?.method ?? 'GET').toUpperCase()
      calls.push({
        url,
        method,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      })
      if (method === 'DELETE') {
        if (deleteThrows) throw new TypeError('Failed to fetch')
        return {
          ok: deleteStatus < 300,
          status: deleteStatus,
          json: async () => ({}),
        } as Response
      }
      if (method === 'GET' && url.startsWith('/api/lists/items/')) {
        return {
          ok: reconcileState !== 'held',
          status: reconcileState === 'held' ? 409 : 200,
          json: async () => ({ state: reconcileState }),
        } as Response
      }
      if (url === '/api/lists/items/create') {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            item: {
              id: 'restored',
              content: 'Tofu',
              checked: false,
              quantity: 2,
              category: 'Protein',
              amount: 400,
              unit: 'g',
              ingredient_id: 'ing_tofu',
            },
          }),
        } as Response
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response
    },
  ) as unknown as typeof fetch
})

function renderList(
  paging?: React.ComponentProps<typeof ListDetailClient>['paging'],
) {
  render(
    <ToastProvider>
      <ListDetailClient
        listId="l1"
        listName="Groceries"
        listType="grocery"
        userId="u1"
        ownerGeneration={0}
        paging={paging}
        items={[
          {
            id: 'a',
            content: 'Tofu',
            checked: true,
            quantity: 2,
            category: 'Protein',
            added_by: { name: 'Pat' },
            amount: 400,
            unit: 'g',
            ingredient_id: 'ing_tofu',
            ingredient_name: 'Tofu',
          },
          {
            id: 'b',
            content: 'Milk',
            checked: false,
            quantity: 1,
            category: null,
            added_by: { name: 'Pat' },
          },
        ]}
      />
    </ToastProvider>,
  )
}

it('deletes without confirm and Undo re-creates the item (ticked again)', async () => {
  const user = userEvent.setup()
  renderList()
  const row = screen
    .getByRole('checkbox', { name: /Tofu/ })
    .closest('[data-testid="list-item"]')!.parentElement!
  await user.click(within(row).getByRole('button', { name: 'Swipe to delete' }))

  expect(window.confirm).not.toHaveBeenCalled()
  expect(screen.queryByRole('checkbox', { name: /Tofu/ })).toBeNull()
  expect(calls[0]).toMatchObject({
    url: '/api/lists/items/a',
    method: 'DELETE',
  })

  const toast = await screen.findByTestId('undo-toast')
  expect(toast.textContent).toContain('Deleted “Tofu”')
  await user.click(within(toast).getByRole('button', { name: 'Undo' }))

  await screen.findByRole('checkbox', { name: /Tofu/ })
  expect(calls[1]).toEqual({
    url: '/api/lists/items/create',
    method: 'POST',
    body: {
      listId: 'l1',
      content: 'Tofu',
      quantity: 2,
      category: 'Protein',
      amount: 400,
      unit: 'g',
      ingredient_id: 'ing_tofu',
    },
  })
  await waitFor(() =>
    expect(mockSetChecked).toHaveBeenCalledWith('restored', true),
  )
})

it('puts the row back and says so when the delete fails', async () => {
  const user = userEvent.setup()
  deleteStatus = 403
  renderList()
  const row = screen
    .getByRole('checkbox', { name: /Milk/ })
    .closest('[data-testid="list-item"]')!.parentElement!
  await user.click(within(row).getByRole('button', { name: 'Swipe to delete' }))
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain("Couldn't delete “Milk”")
  expect(screen.getByRole('checkbox', { name: /Milk/ })).toBeTruthy()
  expect(screen.queryByTestId('undo-toast')).toBeNull()
})

it('treats a received 404 as already gone without offering Undo', async () => {
  const user = userEvent.setup()
  deleteStatus = 404
  mockQueued.set('b', true)
  renderList()
  const row = screen
    .getByRole('checkbox', { name: /Milk/ })
    .closest('[data-testid="list-item"]')!.parentElement!
  await user.click(within(row).getByRole('button', { name: 'Swipe to delete' }))

  await waitFor(() =>
    expect(screen.queryByRole('checkbox', { name: /Milk/ })).toBeNull(),
  )
  expect(mockDiscard).toHaveBeenCalledWith('op-b')
  expect(mockRefresh).toHaveBeenCalledTimes(1)
  expect(screen.queryByTestId('undo-toast')).toBeNull()
  expect(
    await screen.findByText('“Milk” was already removed from the list.'),
  ).toBeTruthy()
  expect(calls).toEqual([
    { url: '/api/lists/items/b', method: 'DELETE', body: undefined },
  ])
})

it('holds a lost delete response and does not offer Undo until exact status is checked', async () => {
  const user = userEvent.setup()
  deleteThrows = true
  renderList()
  const row = screen
    .getByRole('checkbox', { name: /Milk/ })
    .closest('[data-testid="list-item"]')!.parentElement!
  await user.click(within(row).getByRole('button', { name: 'Swipe to delete' }))

  const held = (await screen.findAllByTestId('list-item')).find(
    (candidate) => candidate.getAttribute('data-item-id') === 'b',
  )!
  expect(held).toHaveAttribute('data-item-id', 'b')
  expect(held).toHaveAttribute('data-delete-state', 'unknown')
  expect(
    screen.getByRole('button', { name: 'Check delete status' }),
  ).toBeTruthy()
  expect(screen.queryByTestId('undo-toast')).toBeNull()
  expect(calls).toEqual([
    { url: '/api/lists/items/b', method: 'DELETE', body: undefined },
    {
      url: '/api/lists/items/b?listId=l1&userId=u1&generation=0',
      method: 'GET',
      body: undefined,
    },
  ])
})

it('keeps a held row when the exact status read still finds it', async () => {
  const user = userEvent.setup()
  deleteThrows = true
  reconcileState = 'found'
  renderList()
  const row = screen
    .getByRole('checkbox', { name: /Milk/ })
    .closest('[data-testid="list-item"]')!.parentElement!
  await user.click(within(row).getByRole('button', { name: 'Swipe to delete' }))

  await waitFor(() =>
    expect(screen.getByRole('checkbox', { name: /Milk/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    ),
  )
  expect(screen.queryByTestId('undo-toast')).toBeNull()
  expect(
    screen.getByText(
      '“Milk” is still on the list. The delete result is still unknown; check again.',
    ),
  ).toBeTruthy()
})

it('offers Undo only after the exact status read proves the item is missing', async () => {
  const user = userEvent.setup()
  deleteThrows = true
  reconcileState = 'missing'
  renderList()
  const row = screen
    .getByRole('checkbox', { name: /Milk/ })
    .closest('[data-testid="list-item"]')!.parentElement!
  await user.click(within(row).getByRole('button', { name: 'Swipe to delete' }))

  await waitFor(() =>
    expect(screen.queryByRole('checkbox', { name: /Milk/ })).toBeNull(),
  )
  expect(await screen.findByTestId('undo-toast')).toBeTruthy()
})

it('restores a paged item at the canonical tail and preserves its tick without inserting it into this page', async () => {
  const user = userEvent.setup()
  renderList({
    continued: false,
    firstHref: '/dashboard/lists/l1',
    nextHref: '/dashboard/lists/l1?cursor=next',
    versionQuery: 'limit=100',
  })
  const row = screen
    .getByRole('checkbox', { name: /Tofu/ })
    .closest('[data-testid="list-item"]')!.parentElement!
  await user.click(within(row).getByRole('button', { name: 'Swipe to delete' }))
  const toast = await screen.findByTestId('undo-toast')
  await user.click(within(toast).getByRole('button', { name: 'Undo' }))

  await screen.findByText('Restored “Tofu”')
  expect(screen.queryByRole('checkbox', { name: /Tofu/ })).toBeNull()
  expect(screen.getByRole('checkbox', { name: /Milk/ })).toBeTruthy()
  expect(mockRefresh).toHaveBeenCalledTimes(1)
  expect(
    calls.filter((call) => call.url === '/api/lists/items/create'),
  ).toEqual([
    {
      url: '/api/lists/items/create',
      method: 'POST',
      body: {
        listId: 'l1',
        content: 'Tofu',
        quantity: 2,
        category: 'Protein',
        amount: 400,
        unit: 'g',
        ingredient_id: 'ing_tofu',
      },
    },
  ])
  await waitFor(() =>
    expect(mockSetChecked).toHaveBeenCalledWith('restored', true),
  )
})

it('Undo restores the tick the person saw, even one still queued offline, and drops the stale queued change', async () => {
  const user = userEvent.setup()
  // Milk is unticked on the server but shows ticked from a queued offline change.
  mockQueued.set('b', true)
  renderList()
  const row = screen
    .getByRole('checkbox', { name: /Milk/ })
    .closest('[data-testid="list-item"]')!.parentElement!
  await user.click(within(row).getByRole('button', { name: 'Swipe to delete' }))

  await waitFor(() => expect(mockDiscard).toHaveBeenCalledWith('op-b'))
  const toast = await screen.findByTestId('undo-toast')
  await user.click(within(toast).getByRole('button', { name: 'Undo' }))
  await waitFor(() =>
    expect(mockSetChecked).toHaveBeenCalledWith('restored', true),
  )
})

// Canonical refresh after a queued create; navigation is covered in browser tests.
jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}))

// Submitted-create replay has its own real-queue component and browser suite.
jest.mock('../PersonGroceryAdd', () => ({ PersonGroceryAdd: () => null }))
