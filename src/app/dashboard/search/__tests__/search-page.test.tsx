/**
 * @jest-environment jsdom
 */
// /dashboard/search (route inventory F-3): it used to show "No results" for
// every query. Now it asks GET /api/search after a short pause and shows the
// household's results, with loading, empty, error and offline states.
import * as React from 'react'
import '@testing-library/jest-dom'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SearchClient from '../SearchClient'

type Reply = { status: number; body: unknown }
let calls: string[] = []
let reply: (url: string) => Reply

const RESULTS = [
  { type: 'member', id: 'u1', title: 'Milo', subtitle: 'Child', href: '/dashboard/family' },
  { type: 'list', id: 'l1', title: 'Milk run', subtitle: 'Shopping list', href: '/dashboard/lists/l1' },
  { type: 'list_item', id: 'i1', title: 'Oat milk', subtitle: 'On Groceries', href: '/dashboard/lists/l2' },
]

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => value })
}

beforeEach(() => {
  calls = []
  setOnline(true)
  window.history.replaceState(null, '', '/dashboard/search')
  reply = () => ({ status: 200, body: { results: RESULTS } })
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    const { status, body } = reply(url)
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
  }) as unknown as typeof fetch
})

const box = () => screen.getByRole('searchbox', { name: 'Search your household' })

it('starts with a hint and sends nothing', () => {
  render(<SearchClient />)
  expect(screen.getByTestId('search-idle')).toHaveTextContent('Only your household is searched')
  expect(calls).toEqual([])
})

it('waits for a pause, then asks once and shows results grouped by kind', async () => {
  const user = userEvent.setup()
  render(<SearchClient />)
  await user.type(box(), 'milk')
  expect(await screen.findByRole('link', { name: /Milk run/ })).toHaveAttribute('href', '/dashboard/lists/l1')
  // Typing four letters quickly sends one request, for the whole word.
  expect(calls).toEqual(['/api/search?q=milk'])
  expect(screen.getByRole('heading', { name: 'People' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Lists' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'On a list' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /Oat milk.*On Groceries/ })).toHaveAttribute('href', '/dashboard/lists/l2')
  expect(screen.getByRole('status')).toHaveTextContent('3 results for “milk”.')
  expect(window.location.search).toBe('?q=milk')
})

it('says "Searching…" while it waits', async () => {
  let release: () => void = () => undefined
  global.fetch = jest.fn(
    () =>
      new Promise((resolve) => {
        release = () => resolve({ ok: true, status: 200, json: async () => ({ results: [] }) } as Response)
      })
  ) as unknown as typeof fetch
  const user = userEvent.setup()
  render(<SearchClient />)
  await user.type(box(), 'eggs')
  expect(screen.getByTestId('search-loading')).toHaveTextContent('Searching…')
  expect(screen.getByRole('status')).toHaveTextContent('Searching…')
  await waitFor(() => expect(global.fetch).toHaveBeenCalled())
  await act(async () => release())
  expect(await screen.findByTestId('search-empty')).toHaveTextContent('Nothing matches “eggs”.')
})

it('asks for one more letter before searching', async () => {
  const user = userEvent.setup()
  render(<SearchClient />)
  await user.type(box(), 'm')
  expect(screen.getByTestId('search-short')).toHaveTextContent('Search starts at 2 letters')
  await new Promise((r) => setTimeout(r, 400))
  expect(calls).toEqual([])
})

it('says so when nothing matches', async () => {
  reply = () => ({ status: 200, body: { results: [] } })
  const user = userEvent.setup()
  render(<SearchClient />)
  await user.type(box(), 'zebra')
  expect(await screen.findByTestId('search-empty')).toHaveTextContent('Nothing matches “zebra”.')
  expect(screen.getByRole('status')).toHaveTextContent('Nothing matches “zebra”.')
})

it('shows an error with Try again, which searches again', async () => {
  reply = () => ({ status: 500, body: { error: 'boom' } })
  const user = userEvent.setup()
  render(<SearchClient />)
  await user.type(box(), 'milk')
  expect(await screen.findByRole('alert')).toHaveTextContent("Search didn't work. Check your connection and try again.")
  reply = () => ({ status: 200, body: { results: RESULTS } })
  await user.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByRole('link', { name: /Milk run/ })).toBeInTheDocument()
  expect(calls).toEqual(['/api/search?q=milk', '/api/search?q=milk'])
})

it('says it is offline and sends nothing', async () => {
  setOnline(false)
  const user = userEvent.setup()
  render(<SearchClient />)
  await user.type(box(), 'milk')
  expect(screen.getByTestId('search-offline')).toHaveTextContent("You're offline. Search needs a connection.")
  await new Promise((r) => setTimeout(r, 400))
  expect(calls).toEqual([])
  // Back online: the search runs.
  setOnline(true)
  act(() => {
    window.dispatchEvent(new Event('online'))
  })
  expect(await screen.findByRole('link', { name: /Milk run/ })).toBeInTheDocument()
})

it('opens with ?q= from the palette and searches straight away', async () => {
  render(<SearchClient initialQuery="milk" />)
  expect(box()).toHaveValue('milk')
  expect(await screen.findByRole('link', { name: /Milk run/ })).toBeInTheDocument()
  expect(calls).toEqual(['/api/search?q=milk'])
})

it('moves through results with the arrow keys and clears with Escape', async () => {
  const user = userEvent.setup()
  render(<SearchClient />)
  await user.type(box(), 'milk')
  const links = await screen.findAllByRole('link')
  expect(links).toHaveLength(3)
  await user.keyboard('{ArrowDown}')
  expect(links[0]).toHaveFocus()
  await user.keyboard('{ArrowDown}')
  expect(links[1]).toHaveFocus()
  await user.keyboard('{ArrowUp}{ArrowUp}')
  expect(box()).toHaveFocus()
  await user.keyboard('{Escape}')
  expect(box()).toHaveValue('')
  expect(screen.getByTestId('search-idle')).toBeInTheDocument()
})

it('has a labelled clear button of a touch-friendly size', async () => {
  const user = userEvent.setup()
  render(<SearchClient />)
  await user.type(box(), 'milk')
  const clear = screen.getByRole('button', { name: 'Clear search' })
  expect(clear.className).toMatch(/h-11 w-11/)
  await user.click(clear)
  expect(box()).toHaveValue('')
  expect(box()).toHaveFocus()
})
