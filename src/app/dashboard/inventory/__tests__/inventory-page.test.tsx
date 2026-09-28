/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toDateOnlyLocal } from '@/lib/dates'
import InventoryClient from '../InventoryClient'

let mockMealsOn = true
jest.mock('@/components/providers/features-provider', () => ({
  useFeatureEnabled: (key: string) => (key === 'meals' ? mockMealsOn : true),
}))

const today = toDateOnlyLocal(new Date())

const ITEMS = [
  {
    id: 'i-milk', name: 'Milk', ingredient_id: null, amount: 1, unit: 'L', location: 'fridge', expires_on: '2026-01-04',
    added_by: 'u', created_at: '', updated_at: '', expiry: { status: 'expired', daysLeft: -1 },
  },
  {
    id: 'i-tom', name: 'Tomatoes', ingredient_id: 'ing-tom', amount: 6, unit: null, location: 'fridge', expires_on: '2026-01-07',
    added_by: 'u', created_at: '', updated_at: '', expiry: { status: 'soon', daysLeft: 2 },
  },
  {
    id: 'i-peas', name: 'Peas', ingredient_id: null, amount: null, unit: null, location: 'freezer', expires_on: null,
    added_by: 'u', created_at: '', updated_at: '', expiry: { status: 'none', daysLeft: null },
  },
]
const USE_SOON = [
  { id: 'i-milk', name: 'Milk', location: 'fridge', expiresOn: '2026-01-04', daysLeft: -1, status: 'expired', label: 'Expired yesterday' },
  { id: 'i-tom', name: 'Tomatoes', location: 'fridge', expiresOn: '2026-01-07', daysLeft: 2, status: 'soon', label: 'Use in 2 days' },
]
const COOK = {
  recipesConsidered: 2,
  truncated: false,
  suggestions: [
    {
      recipeId: 'r-soup', title: 'Tomato soup', prep_time: 10, cook_time: 20, servings: 4,
      totalCount: 2, haveCount: 1, missingCount: 1, coverage: 0.5, useSoonCount: 1,
      have: [{ ingredientId: 'ing-tom', name: 'Tomatoes' }],
      missing: [{ ingredientId: 'ing-stock', name: 'Stock' }],
    },
  ],
}

type Call = { url: string; method: string; body: unknown; headers: Record<string, string> }

function setup({
  canWrite = true,
  items = ITEMS,
  listStatus = 200,
}: { canWrite?: boolean; items?: unknown[]; listStatus?: number } = {}) {
  const calls: Call[] = []
  const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ url, method, body, headers: (init?.headers ?? {}) as Record<string, string> })
    const json = (status: number, data: unknown) =>
      ({ ok: status >= 200 && status < 300, status, json: async () => data, headers: { get: () => null } }) as unknown as Response
    if (url.startsWith('/api/inventory/use-soon')) return json(200, { days: 3, items: USE_SOON })
    if (url.startsWith('/api/inventory/cook')) return json(200, COOK)
    if (url.startsWith('/api/inventory?') && method === 'GET') {
      return json(listStatus, listStatus === 200 ? { items, nextOffset: null } : { error: { code: 'INTERNAL_ERROR', message: 'x' } })
    }
    if (url.startsWith('/api/inventory?') && method === 'POST') return json(201, { item: { id: 'new' } })
    if (url.startsWith('/api/inventory/') && method === 'PATCH') return json(200, { item: { id: 'x' } })
    if (url.startsWith('/api/inventory/') && method === 'DELETE') return json(200, { success: true })
    if (url === '/api/lists/items/from-recipe') {
      return json(201, {
        listId: 'l1', listName: 'Groceries', requestId: 'req-1', createdCount: 1, alreadyOnListCount: 0,
        possibleDuplicates: [], possibleDuplicatesTruncated: false,
        undoExpiresAt: new Date(Date.now() + 600_000).toISOString(),
      })
    }
    return json(404, {})
  })
  global.fetch = fetchMock as unknown as typeof fetch
  window.confirm = jest.fn(() => true)
  render(<InventoryClient canWrite={canWrite} canOpenRecipes={canWrite} />)
  return { calls }
}

describe('/dashboard/inventory', () => {
  beforeEach(() => {
    mockMealsOn = true
  })

  it('groups items by location with written expiry labels, and sends the viewer day', async () => {
    const { calls } = setup()
    const fridge = await screen.findByRole('region', { name: /Fridge/ })
    const fridgeRows = within(fridge).getAllByTestId('inventory-item')
    // Most urgent first; the label is text, not just colour.
    expect(fridgeRows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Expired yesterday'),
      expect.stringContaining('Use in 2 days'),
    ])
    expect(fridgeRows[0].textContent).toContain('1 L')
    const freezer = screen.getByRole('region', { name: /Freezer/ })
    expect(within(freezer).getByText('No date')).toBeTruthy()
    const pantry = screen.getByRole('region', { name: /Pantry/ })
    expect(within(pantry).getByText('Nothing in the pantry.')).toBeTruthy()
    for (const path of ['/api/inventory?', '/api/inventory/use-soon?', '/api/inventory/cook?']) {
      expect(calls.find((c) => c.url.startsWith(path))!.url).toContain(`today=${today}`)
    }
  })

  it('shows use-soon items and ranked recipes, and adds only the missing ingredients to groceries', async () => {
    const user = userEvent.setup()
    const { calls } = setup()
    const soon = await screen.findByTestId('use-soon')
    await waitFor(() => expect(within(soon).getAllByTestId('use-soon-item')).toHaveLength(2))
    expect(within(soon).getByText('Expired yesterday')).toBeTruthy()

    const cook = await screen.findByTestId('cook-suggestion')
    expect(within(cook).getByText('Tomato soup')).toBeTruthy()
    expect(within(cook).getByTestId('cook-coverage').textContent).toBe('You have 1 of 2 ingredients · uses 1 item to use soon')
    expect(within(cook).getByTestId('cook-missing').textContent).toContain('Stock')
    await user.click(within(cook).getByRole('button', { name: 'Add 1 missing to groceries' }))
    await waitFor(() => expect(calls.some((c) => c.url === '/api/lists/items/from-recipe')).toBe(true))
    const add = calls.find((c) => c.url === '/api/lists/items/from-recipe')!
    expect(add.body).toEqual({ recipeId: 'r-soup', ingredientIds: ['ing-stock'] })
    expect(await within(cook).findByText(/Added 1 item to Groceries/)).toBeTruthy()
  })

  it('adds and edits an item through the dialog', async () => {
    const user = userEvent.setup()
    const { calls } = setup()
    await screen.findAllByTestId('inventory-item')
    await user.click(screen.getAllByRole('button', { name: 'Add item' })[0])
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Name'), '  Yogurt ')
    await user.click(within(dialog).getByLabelText('Freezer'))
    await user.type(within(dialog).getByLabelText(/Amount/), '2')
    await user.type(within(dialog).getByLabelText(/Use by/), '2026-01-09')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true))
    const post = calls.find((c) => c.method === 'POST')!
    expect(post.url).toContain(`/api/inventory?today=${today}`)
    expect(post.body).toEqual({ name: 'Yogurt', location: 'freezer', amount: 2, unit: null, expires_on: '2026-01-09' })
    expect(await screen.findByText('Added Yogurt.')).toBeTruthy()

    await user.click(await screen.findByRole('button', { name: 'Edit Peas' }))
    const edit = await screen.findByRole('dialog')
    await user.click(within(edit).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/inventory/i-peas')).toBe(true))
  })

  it('a child sees the inventory without write controls', async () => {
    setup({ canWrite: false })
    await screen.findAllByTestId('inventory-item')
    expect(screen.queryByRole('button', { name: 'Add item' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Edit / })).toBeNull()
    expect(screen.queryByRole('link', { name: /View recipe/ })).toBeNull()
  })

  it('shows empty and error states', async () => {
    const user = userEvent.setup()
    setup({ items: [] })
    expect(await screen.findByText('Nothing tracked yet')).toBeTruthy()
    document.body.innerHTML = ''
    const { calls } = setup({ listStatus: 500 })
    expect(await screen.findByText("Couldn't load the inventory")).toBeTruthy()
    const before = calls.length
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(calls.length).toBeGreaterThan(before))
  })

  it('leaves out "What can I cook" when meal planning is off', async () => {
    mockMealsOn = false
    const { calls } = setup()
    await screen.findAllByTestId('inventory-item')
    expect(screen.queryByTestId('what-can-i-cook')).toBeNull()
    expect(calls.some((c) => c.url.startsWith('/api/inventory/cook'))).toBe(false)
  })
})
