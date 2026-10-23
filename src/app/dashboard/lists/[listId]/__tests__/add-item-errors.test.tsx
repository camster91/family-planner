/**
 * @jest-environment jsdom
 */
// Adding a list item: a failed add used to do nothing at all. It now says why
// (the server's reason, or that the device is offline) and keeps the text.
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ListDetailClient from '../ListDetailClient'
import { ToastProvider } from '@/components/ui/toast'

jest.mock('../use-list-item-sync', () => ({
  __emptyOperations: Object.freeze([]),
  useListItemSync: () => ({
    operations: require('../use-list-item-sync').__emptyOperations,
    online: true,
    durable: true,
    pendingCount: 0,
    notice: null,
    dismissNotice: () => {},
    stateFor: () => undefined,
    setChecked: async () => {},
    retry: async () => {},
    discard: async () => {},
  }),
}))

let createReply: () => Promise<Response>
let calls: string[] = []
const mockRefresh = jest.fn()

beforeEach(() => {
  calls = []
  mockRefresh.mockClear()
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true })
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    calls.push(String(input))
    return createReply()
  }) as unknown as typeof fetch
})

function renderList() {
  render(
    <ToastProvider>
      <ListDetailClient listId="l1" listName="Groceries" listType="todo" userId="u1" items={[]} />
    </ToastProvider>
  )
  return screen.getByPlaceholderText('Add an item…') as HTMLInputElement
}

it("shows the server's error and keeps the typed text", async () => {
  createReply = async () => ({ ok: false, status: 400, json: async () => ({ error: 'Item is too long' }) }) as Response
  const user = userEvent.setup()
  const input = renderList()
  await user.type(input, 'Milk{Enter}')

  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toBe("Couldn't add “Milk”. Item is too long")
  expect(input.value).toBe('Milk')
  expect(input.disabled).toBe(false)
  expect(input.getAttribute('aria-describedby')).toBe(alert.id)
})

it('says to check the connection when the request fails', async () => {
  createReply = async () => {
    throw new TypeError('Failed to fetch')
  }
  const user = userEvent.setup()
  const input = renderList()
  await user.type(input, 'Eggs')
  await user.click(screen.getByRole('button', { name: 'Add' }))

  expect((await screen.findByRole('alert')).textContent).toContain('Check your connection')
  expect(input.value).toBe('Eggs')
})

it('says the device is offline without sending', async () => {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false })
  createReply = async () => ({ ok: true, status: 201, json: async () => ({}) }) as Response
  const user = userEvent.setup()
  const input = renderList()
  await user.type(input, 'Bread{Enter}')

  expect((await screen.findByRole('alert')).textContent).toContain("You're offline")
  expect(input.value).toBe('Bread')
  expect(calls).toEqual([])
})

it('adds the item and clears the error on success', async () => {
  let fail = true
  createReply = async () =>
    (fail
      ? { ok: false, status: 500, json: async () => ({}) }
      : { ok: true, status: 201, json: async () => ({ item: { id: 'i1', content: 'Milk', checked: false, quantity: 1, category: null } }) }) as Response
  const user = userEvent.setup()
  const input = renderList()
  await user.type(input, 'Milk{Enter}')
  expect((await screen.findByRole('alert')).textContent).toBe("Couldn't add “Milk”. Please try again.")

  fail = false
  await user.type(input, '{Enter}')
  await screen.findByRole('checkbox', { name: /Milk/ })
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  expect(input.value).toBe('')
})

it('keeps a newly appended item off the current page until its canonical page is loaded', async () => {
  const item = { id: 'tail', content: 'Milk', checked: false, quantity: 1, category: null, added_by: { name: 'Pat' } }
  createReply = async () => ({ ok: true, status: 201, json: async () => ({ item }) }) as Response
  const paging = { continued: false, firstHref: '/dashboard/lists/l1', nextHref: '/dashboard/lists/l1?cursor=next', versionQuery: 'limit=100' }
  const page = (items: typeof item[], continued: boolean) => (
    <ToastProvider>
      <ListDetailClient listId="l1" listName="Tasks" listType="todo" userId="u1" items={items}
        paging={{ ...paging, continued, nextHref: continued ? null : paging.nextHref }} />
    </ToastProvider>
  )
  const view = render(page([], false))
  const user = userEvent.setup()
  await user.type(screen.getByPlaceholderText('Add an item…'), 'Milk{Enter}')

  await screen.findByText('Added “Milk”')
  expect(calls).toEqual(['/api/lists/items/create'])
  expect(mockRefresh).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('checkbox', { name: /Milk/ })).toBeNull()
  expect(screen.getByPlaceholderText('Add an item…')).toHaveValue('')
  expect(screen.getByText('Saved at the end of your list. It may appear on a later page.')).toBeTruthy()

  view.rerender(page([item], true))
  await waitFor(() => expect(screen.getAllByRole('checkbox', { name: /Milk/ })).toHaveLength(1))
  expect(calls).toHaveLength(1)
})

// Canonical refresh after a queued create; navigation is covered in browser tests.
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mockRefresh }) }))

// Submitted-create replay has its own real-queue component and browser suite.
jest.mock('../PersonGroceryAdd', () => ({ PersonGroceryAdd: () => null }))
