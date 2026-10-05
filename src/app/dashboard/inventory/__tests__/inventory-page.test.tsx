/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toDateOnlyLocal } from '@/lib/dates'
import InventoryClient, { OFFLINE_WRITE_MESSAGE } from '../InventoryClient'
import { ToastProvider } from '@/components/ui/toast'

let mockMealsOn = true
jest.mock('@/components/providers/features-provider', () => ({
  useFeatureEnabled: (key: string) => (key === 'meals' ? mockMealsOn : true),
}))

const today = toDateOnlyLocal(new Date())

const ITEMS = [
  {
    id: 'i-milk', name: 'Milk', ingredient_id: null, amount: 1, unit: 'L', location: 'fridge', expires_on: '2026-01-04',
    date_kind: 'best_before', category: 'dairy_eggs', purchased_on: null, opened_on: '2026-01-02', status: 'active', finished_at: null,
    added_by: 'u', created_at: '', updated_at: '', expiry: { status: 'expired', daysLeft: -1 },
  },
  {
    id: 'i-tom', name: 'Tomatoes', ingredient_id: 'ing-tom', amount: 6, unit: null, location: 'fridge', expires_on: '2026-01-07',
    date_kind: 'best_before', category: 'produce', purchased_on: null, opened_on: null, status: 'active', finished_at: null,
    added_by: 'u', created_at: '', updated_at: '', expiry: { status: 'soon', daysLeft: 2 },
  },
  {
    id: 'i-peas', name: 'Peas', ingredient_id: null, amount: null, unit: null, location: 'freezer', expires_on: null,
    // An item as an older server sends it: no #158 fields.
    added_by: 'u', created_at: '', updated_at: '', expiry: { status: 'none', daysLeft: null },
  },
]
const CHICKEN = {
  id: 'i-chicken', name: 'Chicken', ingredient_id: null, amount: null, unit: null, location: 'fridge', expires_on: '2026-01-03',
  date_kind: 'use_by', category: 'meat_fish', purchased_on: null, opened_on: null, status: 'active', finished_at: null,
  added_by: 'u', created_at: '', updated_at: '', expiry: { status: 'past_use_by', daysLeft: -2 },
}
const HISTORY = [
  {
    id: 'adj-1', item_id: 'i-old', kind: 'discard', amount_delta: null, amount_before: null, amount_after: null,
    status_before: 'active', status_after: 'discarded', actor_id: 'u', created_at: '2026-01-04T10:00:00.000Z', undone_at: null,
    item_name: 'Old soup', item_status: 'discarded', undoable: true,
  },
  {
    // Not the latest change to its item any more: no Undo.
    id: 'adj-0', item_id: 'i-milk', kind: 'consume', amount_delta: -0.5, amount_before: 1.5, amount_after: 1,
    status_before: 'active', status_after: 'active', actor_id: 'u', created_at: '2026-01-03T10:00:00.000Z', undone_at: null,
    item_name: 'Milk', item_status: 'active', undoable: false,
  },
]
const USE_SOON = [
  { id: 'i-milk', name: 'Milk', location: 'fridge', expiresOn: '2026-01-04', dateKind: 'best_before', daysLeft: -1, status: 'expired', label: 'Best before was yesterday' },
  { id: 'i-tom', name: 'Tomatoes', location: 'fridge', expiresOn: '2026-01-07', dateKind: 'best_before', daysLeft: 2, status: 'soon', label: 'Best before in 2 days' },
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
  page,
  cook = COOK,
  history = [] as unknown[],
  writeStatus = 200,
}: {
  canWrite?: boolean
  items?: unknown[]
  listStatus?: number | (() => number)
  /** Paged list mock: the items and nextOffset for a given offset. */
  page?: (offset: number) => { items: unknown[]; nextOffset: number | null }
  cook?: unknown
  history?: unknown[]
  /** Status of PATCH / consume / discard / undo answers. */
  writeStatus?: number
} = {}) {
  const calls: Call[] = []
  const listCode = () => (typeof listStatus === 'function' ? listStatus() : listStatus)
  const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ url, method, body, headers: (init?.headers ?? {}) as Record<string, string> })
    const json = (status: number, data: unknown) =>
      ({ ok: status >= 200 && status < 300, status, json: async () => data, headers: { get: () => null } }) as unknown as Response
    if (url.startsWith('/api/inventory/use-soon')) return json(200, { days: 3, items: USE_SOON })
    if (url.startsWith('/api/inventory/cook')) return json(200, cook)
    if (url.startsWith('/api/inventory?') && method === 'GET' && page) {
      return json(200, page(Number(new URL(url, 'http://x').searchParams.get('offset') ?? '0')))
    }
    if (url.startsWith('/api/inventory?') && method === 'GET') {
      const code = listCode()
      return json(code, code === 200 ? { items, nextOffset: null } : { error: { code: 'INTERNAL_ERROR', message: 'x' } })
    }
    if (url.startsWith('/api/inventory/adjustments?')) return json(200, { adjustments: history, nextOffset: null })
    const adjust = url.match(/^\/api\/inventory\/([^/?]+)\/(consume|discard)\?/)
    if (adjust && method === 'POST') {
      if (writeStatus !== 200) return json(writeStatus, { error: { code: 'INVENTORY_ITEM_FINISHED', message: 'This item was already used up or thrown away.' } })
      const partial = adjust[2] === 'consume' && (body as { amount?: number })?.amount !== undefined
      return json(200, {
        item: { id: adjust[1], status: partial ? 'active' : adjust[2] === 'consume' ? 'consumed' : 'discarded' },
        adjustment: { id: `adj-${adjust[1]}`, item_id: adjust[1], kind: adjust[2], status_after: partial ? 'active' : 'consumed' },
      })
    }
    if (/^\/api\/inventory\/adjustments\/[^/]+\/undo\?/.test(url) && method === 'POST') {
      if (writeStatus !== 200) return json(409, { error: { code: 'INVENTORY_UNDO_CONFLICT', message: 'This item changed after that, so it cannot be undone. Edit the item instead.' } })
      return json(200, { item: { id: 'x', status: 'active' }, adjustment: { id: 'adj' }, alreadyUndone: false })
    }
    if (url.startsWith('/api/inventory?') && method === 'POST') return json(201, { item: { id: 'new' } })
    if (url.startsWith('/api/inventory/') && method === 'PATCH') {
      return writeStatus === 200 ? json(200, { item: { id: 'x' } }) : json(writeStatus, { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } })
    }
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
  render(
    <ToastProvider>
      <InventoryClient canWrite={canWrite} canOpenRecipes={canWrite} />
    </ToastProvider>
  )
  return { calls }
}

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online })
  act(() => {
    window.dispatchEvent(new Event(online ? 'online' : 'offline'))
  })
}

const header = (c: Call, name: string) => c.headers[name]

describe('/dashboard/inventory', () => {
  beforeEach(() => {
    mockMealsOn = true
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true })
  })

  it('groups items by location with written expiry labels, and sends the viewer day', async () => {
    const { calls } = setup()
    const fridge = await screen.findByRole('region', { name: /Fridge/ })
    const fridgeRows = within(fridge).getAllByTestId('inventory-item')
    // Most urgent first; the label is text, not just colour.
    expect(fridgeRows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Best before was yesterday'),
      expect.stringContaining('Best before in 2 days'),
    ])
    expect(fridgeRows[0].textContent).toContain('1 L')
    // Date kind, category and opened day are written out.
    expect(fridgeRows[0].textContent).toContain('Best before Jan 4 · Dairy & eggs · Opened Jan 2')
    const freezer = screen.getByRole('region', { name: /Freezer/ })
    expect(within(freezer).getByText('No date')).toBeTruthy()
    const pantry = screen.getByRole('region', { name: /Pantry/ })
    expect(within(pantry).getByText('Nothing in the pantry.')).toBeTruthy()
    // An item from an older server (no #158 fields) still renders.
    expect(within(freezer).getByText('Peas')).toBeTruthy()
    for (const path of ['/api/inventory?', '/api/inventory/use-soon?', '/api/inventory/cook?']) {
      expect(calls.find((c) => c.url.startsWith(path))!.url).toContain(`today=${today}`)
    }
  })

  it("writes dates in the viewer's locale (en-GB: day before month), keeping the month name", async () => {
    const spy = jest.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['en-GB'])
    try {
      const { calls } = setup()
      const fridge = await screen.findByRole('region', { name: /Fridge/ })
      const rows = within(fridge).getAllByTestId('inventory-item')
      await waitFor(() => expect(rows[0].textContent).toContain('Best before 4 Jan · Dairy & eggs · Opened 2 Jan'))
      expect(within(screen.getByTestId('use-soon')).getAllByTestId('use-soon-item')[0].textContent).toContain('4 Jan')
      // The request still sends the YYYY-MM-DD day, not a display date.
      expect(calls.find((c) => c.url.startsWith('/api/inventory?'))!.url).toContain(`today=${today}`)
    } finally {
      spy.mockRestore()
    }
  })

  it('shows use-soon items and ranked recipes, and adds only the missing ingredients to groceries', async () => {
    const user = userEvent.setup()
    const { calls } = setup()
    const soon = await screen.findByTestId('use-soon')
    await waitFor(() => expect(within(soon).getAllByTestId('use-soon-item')).toHaveLength(2))
    expect(within(soon).getByText('Best before was yesterday')).toBeTruthy()

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
    await user.click(within(dialog).getByLabelText('Use by'))
    expect(within(dialog).getByText(/do not eat it after this day/)).toBeTruthy()
    await user.type(within(dialog).getByLabelText('Use by date'), '2026-01-09')
    await user.selectOptions(within(dialog).getByLabelText(/Category/), 'dairy_eggs')
    await user.type(within(dialog).getByLabelText(/Bought/), '2026-01-03')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true))
    const post = calls.find((c) => c.method === 'POST')!
    expect(post.url).toContain(`/api/inventory?today=${today}`)
    expect(post.body).toEqual({
      name: 'Yogurt',
      location: 'freezer',
      amount: 2,
      unit: null,
      expires_on: '2026-01-09',
      date_kind: 'use_by',
      category: 'dairy_eggs',
      purchased_on: '2026-01-03',
      opened_on: null,
    })
    expect(header(post, 'Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/)
    expect(await screen.findByText('Added Yogurt.')).toBeTruthy()

    await user.click(await screen.findByRole('button', { name: 'Edit Peas' }))
    const edit = await screen.findByRole('dialog')
    // An older item without a date kind edits as best before.
    expect((within(edit).getByLabelText('Best before') as HTMLInputElement).checked).toBe(true)
    await user.click(within(edit).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/inventory/i-peas')).toBe(true))
    const del = calls.find((c) => c.method === 'DELETE')!
    expect(header(del, 'Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('an edit retried after a failure reuses its Idempotency-Key; a changed edit gets a new one', async () => {
    const user = userEvent.setup()
    const { calls } = setup({ writeStatus: 500 })
    await user.click(await screen.findByRole('button', { name: 'Edit Tomatoes' }))
    const edit = await screen.findByRole('dialog')
    await user.click(within(edit).getByRole('button', { name: 'Save' }))
    expect(await within(edit).findByRole('alert')).toBeTruthy()
    await user.click(within(edit).getByRole('button', { name: 'Save' }))
    await user.clear(within(edit).getByLabelText('Name'))
    await user.type(within(edit).getByLabelText('Name'), 'Cherry tomatoes')
    await user.click(within(edit).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(3))
    const keys = calls.filter((c) => c.method === 'PATCH').map((c) => header(c, 'Idempotency-Key'))
    expect(keys[0]).toBe(keys[1])
    expect(keys[2]).not.toBe(keys[0])
  })

  it('"Used it" from use soon runs at once, offers Undo, and Undo puts it back', async () => {
    const user = userEvent.setup()
    const { calls } = setup()
    const soon = await screen.findByTestId('use-soon')
    await waitFor(() => expect(within(soon).getAllByTestId('use-soon-item')).toHaveLength(2))
    await user.click(within(soon).getByRole('button', { name: 'Used Milk' }))
    await waitFor(() => expect(calls.some((c) => c.url.startsWith('/api/inventory/i-milk/consume?'))).toBe(true))
    const post = calls.find((c) => c.url.startsWith('/api/inventory/i-milk/consume?'))!
    expect(post.method).toBe('POST')
    expect(post.url).toContain(`today=${today}`)
    expect(post.body).toEqual({})
    expect(header(post, 'Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/)
    const toast = await screen.findByTestId('undo-toast')
    expect(toast.textContent).toContain('Used Milk')
    await user.click(within(toast).getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(calls.some((c) => c.url.startsWith('/api/inventory/adjustments/adj-i-milk/undo?'))).toBe(true))
    expect(await screen.findByText('Put Milk back.')).toBeTruthy()
  })

  it('"Throw away" from use soon, and from the dialog; a partial use sends the amount', async () => {
    const user = userEvent.setup()
    const { calls } = setup()
    const soon = await screen.findByTestId('use-soon')
    await waitFor(() => expect(within(soon).getAllByTestId('use-soon-item')).toHaveLength(2))
    await user.click(within(soon).getByRole('button', { name: 'Throw away Tomatoes' }))
    await waitFor(() => expect(calls.some((c) => c.url.startsWith('/api/inventory/i-tom/discard?'))).toBe(true))
    expect((await screen.findByTestId('undo-toast')).textContent).toContain('Threw away Tomatoes')

    await user.click(screen.getByRole('button', { name: 'Edit Milk' }))
    const edit = await screen.findByRole('dialog')
    await user.type(within(edit).getByLabelText(/How much did you use/), '0.5')
    await user.click(within(edit).getByRole('button', { name: 'Used it' }))
    await waitFor(() => expect(calls.some((c) => c.url.startsWith('/api/inventory/i-milk/consume?'))).toBe(true))
    expect(calls.find((c) => c.url.startsWith('/api/inventory/i-milk/consume?'))!.body).toEqual({ amount: 0.5 })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getAllByTestId('undo-toast').some((t) => t.textContent?.includes('Used 0.5 L of Milk'))).toBe(true)

    // An item without an amount has no "how much" field; Throw away sends no body fields.
    await user.click(screen.getByRole('button', { name: 'Edit Peas' }))
    const peas = await screen.findByRole('dialog')
    expect(within(peas).queryByLabelText(/How much did you use/)).toBeNull()
    await user.click(within(peas).getByRole('button', { name: 'Throw away' }))
    await waitFor(() => expect(calls.some((c) => c.url.startsWith('/api/inventory/i-peas/discard?'))).toBe(true))
  })

  it('shows a server refusal of "Used it" in words', async () => {
    const user = userEvent.setup()
    setup({ writeStatus: 409 })
    const soon = await screen.findByTestId('use-soon')
    await waitFor(() => expect(within(soon).getAllByTestId('use-soon-item')).toHaveLength(2))
    await user.click(within(soon).getByRole('button', { name: 'Used Milk' }))
    expect(await screen.findByText('This item was already used up or thrown away.')).toBeTruthy()
    expect(screen.queryByTestId('undo-toast')).toBeNull()
  })

  it('lists past use-by food separately with "don\'t eat" words and a Throw away action', async () => {
    const user = userEvent.setup()
    const { calls } = setup({ items: [...ITEMS, CHICKEN] })
    const past = await screen.findByTestId('past-use-by')
    expect(within(past).getByText("Past use-by — don't eat")).toBeTruthy()
    expect(within(past).getByText(/should not be eaten/)).toBeTruthy()
    // Never offered as "use soon".
    expect(within(screen.getByTestId('use-soon')).queryByText('Chicken')).toBeNull()
    await user.click(within(past).getByRole('button', { name: 'Throw away Chicken' }))
    await waitFor(() => expect(calls.some((c) => c.url.startsWith('/api/inventory/i-chicken/discard?'))).toBe(true))
  })

  it('searches by name and filters by place and category, with a way back', async () => {
    const user = userEvent.setup()
    setup()
    await screen.findAllByTestId('inventory-item')
    const filters = screen.getByRole('search', { name: 'Search the inventory' })
    await user.type(within(filters).getByLabelText('Search by name'), 'tom')
    expect(screen.getAllByTestId('inventory-item').map((r) => r.getAttribute('data-item-id'))).toEqual(['i-tom'])
    expect(screen.getByTestId('filter-count').textContent).toBe('Showing 1 of 3 items')
    await user.clear(within(filters).getByLabelText('Search by name'))
    await user.selectOptions(within(filters).getByLabelText('Where'), 'freezer')
    expect(screen.getAllByTestId('inventory-item').map((r) => r.getAttribute('data-item-id'))).toEqual(['i-peas'])
    expect(screen.queryByRole('region', { name: /Fridge/ })).toBeNull()
    await user.selectOptions(within(filters).getByLabelText('Where'), 'all')
    await user.selectOptions(within(filters).getByLabelText('Category'), 'dairy_eggs')
    expect(screen.getAllByTestId('inventory-item').map((r) => r.getAttribute('data-item-id'))).toEqual(['i-milk'])
    await user.type(within(filters).getByLabelText('Search by name'), 'zzz')
    expect(screen.getByTestId('no-matches').textContent).toContain('No items match your search.')
    await user.click(within(screen.getByTestId('no-matches')).getByRole('button', { name: 'Clear search' }))
    expect(screen.getAllByTestId('inventory-item')).toHaveLength(3)
  })

  it('offline: says so in words, keeps what was loaded, and refuses writes with a clear message', async () => {
    const user = userEvent.setup()
    const { calls } = setup()
    await screen.findAllByTestId('inventory-item')
    setOnline(false)
    const banner = await screen.findByTestId('inventory-connection')
    expect(banner.textContent).toMatch(/You're offline\. Showing what was loaded at .*Changes need a connection/)
    expect(screen.getAllByTestId('inventory-item')).toHaveLength(3)
    const before = calls.length
    await user.click(within(screen.getByTestId('use-soon')).getByRole('button', { name: 'Used Milk' }))
    expect(await screen.findByText(OFFLINE_WRITE_MESSAGE)).toBeTruthy()
    await user.click(screen.getAllByRole('button', { name: 'Add item' })[0])
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(calls.length).toBe(before)
    // Back online: the page refreshes and the notice goes.
    setOnline(true)
    await waitFor(() => expect(calls.length).toBeGreaterThan(before))
    await waitFor(() => expect(screen.queryByTestId('inventory-connection')).toBeNull())
  })

  it('stale: a failed refresh keeps the last list and says when it was loaded', async () => {
    const user = userEvent.setup()
    let status = 200
    setup({ listStatus: () => status })
    await screen.findAllByTestId('inventory-item')
    status = 500
    // Any write triggers a refresh; use the filter-free path: "Used it".
    await user.click(within(screen.getByTestId('use-soon')).getByRole('button', { name: 'Used Milk' }))
    const banner = await screen.findByTestId('inventory-connection')
    expect(banner.textContent).toMatch(/Couldn't refresh\. Showing what was loaded at .*may be out of date/)
    expect(screen.getAllByTestId('inventory-item')).toHaveLength(3)
    status = 200
    await user.click(within(banner).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.queryByTestId('inventory-connection')).toBeNull())
  })

  it('history keeps Undo available after the toast; an undo conflict is explained', async () => {
    const user = userEvent.setup()
    const { calls } = setup({ history: HISTORY, writeStatus: 409 })
    const history = await screen.findByTestId('inventory-history')
    expect(within(history).getByText('Threw away Old soup')).toBeTruthy()
    // Undo only where the server says it would work.
    expect(within(history).getByText('Used 0.5 of Milk')).toBeTruthy()
    expect(within(history).getAllByRole('button', { name: /^Undo/ })).toHaveLength(1)
    const historyLoads = () => calls.filter((c) => c.url.startsWith('/api/inventory/adjustments?')).length
    const before = historyLoads()
    await user.click(within(history).getByRole('button', { name: 'Undo: Threw away Old soup' }))
    await waitFor(() => expect(calls.some((c) => c.url.startsWith('/api/inventory/adjustments/adj-1/undo?'))).toBe(true))
    expect(await screen.findByText(/cannot be undone\. Edit the item instead/)).toBeTruthy()
    // The history is fetched again after the attempt.
    await waitFor(() => expect(historyLoads()).toBeGreaterThan(before))
  })

  it('a child sees the inventory without write controls', async () => {
    setup({ canWrite: false })
    await screen.findAllByTestId('inventory-item')
    expect(screen.queryByRole('button', { name: 'Add item' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Edit / })).toBeNull()
    expect(screen.queryByRole('link', { name: /View recipe/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Used / })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Throw away / })).toBeNull()
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

  it('follows the list cursor until nextOffset is null', async () => {
    const { calls } = setup({
      page: (offset) => (offset === 0 ? { items: [ITEMS[0]], nextOffset: 500 } : { items: [ITEMS[2]], nextOffset: null }),
    })
    expect(await screen.findByText('Peas')).toBeTruthy()
    const listCalls = calls.filter((c) => c.url.startsWith('/api/inventory?'))
    expect(listCalls.map((c) => new URL(c.url, 'http://x').searchParams.get('offset'))).toEqual(['0', '500'])
    expect(listCalls.every((c) => c.url.includes('limit=500'))).toBe(true)
    expect(screen.getAllByTestId('inventory-item')).toHaveLength(2)
    expect(screen.queryByTestId('items-capped')).toBeNull()
  })

  it('stops after 20 pages and says the list is cut short', async () => {
    const { calls } = setup({
      page: (offset) => ({ items: [{ ...ITEMS[2], id: `i-${offset}` }], nextOffset: offset + 500 }),
    })
    expect((await screen.findByTestId('items-capped')).textContent).toBe('Showing the first 10,000 items.')
    expect(calls.filter((c) => c.url.startsWith('/api/inventory?'))).toHaveLength(20)
    expect(screen.getAllByTestId('inventory-item')).toHaveLength(20)
  })

  it('says cook suggestions may be incomplete when the server capped its inputs', async () => {
    setup({ cook: { ...COOK, inputsTruncated: true } })
    expect((await screen.findByTestId('cook-incomplete')).textContent).toContain('may be incomplete')
    document.body.innerHTML = ''
    setup({ cook: { suggestions: [], recipesConsidered: 1000, truncated: false, inputsTruncated: true } })
    const empty = await screen.findByTestId('cook-empty')
    expect(empty.textContent).toContain('may be incomplete')
    expect(empty.textContent).not.toContain('No saved recipe uses')
  })

  it('leaves out "What can I cook" when meal planning is off', async () => {
    mockMealsOn = false
    const { calls } = setup()
    await screen.findAllByTestId('inventory-item')
    expect(screen.queryByTestId('what-can-i-cook')).toBeNull()
    expect(calls.some((c) => c.url.startsWith('/api/inventory/cook'))).toBe(false)
  })
})
