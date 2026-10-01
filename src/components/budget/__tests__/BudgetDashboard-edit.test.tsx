/**
 * @jest-environment jsdom
 */
// Transactions could be added but never fixed or removed from the budget
// screen. A row now opens the edit form (PATCH), which can also delete
// (DELETE, after a second tap), and the totals reload afterwards.
// "Today"/"Yesterday" depend on the viewer's clock, so the server render shows
// the plain date and the relative label appears only after hydration.
import * as React from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastProvider } from '@/components/ui/toast'
import { formatDateOnly, toDateOnlyLocal } from '@/lib/dates'
import type { BudgetPageData } from '@/app/dashboard/budget/page'

import BudgetDashboard from '../BudgetDashboard'

const localMonth = () => toDateOnlyLocal(new Date()).slice(0, 7)
// Transaction dates are stored as UTC midnight of the calendar day.
const todayKey = () => toDateOnlyLocal(new Date())

const TX = {
  id: 't1',
  amount: 42.5,
  type: 'expense',
  description: 'Groceries',
  notes: 'Weekly shop',
  category_id: null,
  date: `${todayKey()}T00:00:00.000Z`,
  is_recurring: false,
  recurring_interval: null,
  category: null,
  user: { id: 'u1', name: 'Pat', avatar_url: null },
}

function pageData(overrides: Partial<BudgetPageData> = {}): BudgetPageData {
  return {
    month: localMonth(),
    total_income: 0,
    total_expenses: 42.5,
    balance: -42.5,
    budget_limit: null,
    category_breakdown: [],
    recent_transactions: [TX],
    monthly_trend: [],
    ...overrides,
  }
}

let calls: { url: string; method: string; body?: unknown }[]
let stats: BudgetPageData

beforeEach(() => {
  calls = []
  stats = pageData()
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ url, method, body })
    const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json }) as Response
    if (url.startsWith('/api/budget/categories')) return ok({ categories: [] })
    if (url.startsWith('/api/budget/stats')) return ok(stats)
    if (url === '/api/budget/transactions/t1' && method === 'PATCH') {
      stats = pageData({
        total_expenses: body.amount,
        recent_transactions: [{ ...TX, amount: body.amount, description: body.description }],
      })
      return ok({ transaction: { ...TX, ...body } })
    }
    if (url === '/api/budget/transactions/t1' && method === 'DELETE') {
      stats = pageData({ total_expenses: 0, recent_transactions: [] })
      return ok({ success: true })
    }
    return ok({})
  }) as unknown as typeof fetch
})

const renderDashboard = () =>
  render(
    <ToastProvider>
      <BudgetDashboard initialData={pageData()} userId="u1" />
    </ToastProvider>
  )

it('a row opens the edit form, saving sends PATCH and reloads the totals', async () => {
  const user = userEvent.setup()
  renderDashboard()

  await user.click(screen.getByRole('button', { name: /Groceries/ }))
  const dialog = screen.getByRole('dialog', { name: 'Edit Transaction' })
  const amount = within(dialog).getByLabelText('Amount') as HTMLInputElement
  expect(amount.value).toBe('42.5')
  expect((within(dialog).getByLabelText(/Notes/) as HTMLTextAreaElement).value).toBe('Weekly shop')

  await user.clear(amount)
  await user.type(amount, '50')
  await user.click(within(dialog).getByRole('button', { name: 'Save Changes' }))

  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  const patch = calls.find((c) => c.method === 'PATCH')
  expect(patch?.url).toBe('/api/budget/transactions/t1')
  expect(patch?.body).toMatchObject({ amount: 50, description: 'Groceries', notes: 'Weekly shop' })
  await waitFor(() => expect(calls.some((c) => c.url === `/api/budget/stats?month=${localMonth()}`)).toBe(true))
  expect((await screen.findAllByText('$50.00')).length).toBeGreaterThan(0)
})

it('deletes only after a second tap, then reloads and says so', async () => {
  const user = userEvent.setup()
  renderDashboard()

  await user.click(screen.getByRole('button', { name: /Groceries/ }))
  const dialog = screen.getByRole('dialog', { name: 'Edit Transaction' })
  await user.click(within(dialog).getByRole('button', { name: /Delete transaction/ }))
  expect(calls.some((c) => c.method === 'DELETE')).toBe(false)

  await user.click(within(dialog).getByRole('button', { name: 'Keep' }))
  expect(calls.some((c) => c.method === 'DELETE')).toBe(false)

  await user.click(within(dialog).getByRole('button', { name: /Delete transaction/ }))
  await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.url)).toEqual(['/api/budget/transactions/t1'])
  expect(await screen.findByText('Transaction deleted')).toBeTruthy()
  expect(await screen.findByText('No transactions')).toBeTruthy()
})

it('the add form is a labelled dialog with a named close button', async () => {
  const user = userEvent.setup()
  renderDashboard()
  await user.click(screen.getByRole('button', { name: 'Add transaction' }))
  const dialog = screen.getByRole('dialog', { name: 'Add Transaction' })
  for (const label of ['Amount', 'Description', 'Date', /Notes/]) {
    expect(within(dialog).getByLabelText(label)).toBeTruthy()
  }
  expect(within(dialog).getByRole('switch', { name: 'Recurring' })).toBeTruthy()
  expect(within(dialog).queryByRole('button', { name: /Delete/ })).toBeNull()
  await user.click(within(dialog).getByRole('button', { name: 'Close' }))
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('renders the plain date on the server and "Today" only after hydration', () => {
  // jsdom lacks TextEncoder, which react-dom/server needs at load time.
  Object.assign(globalThis, { TextEncoder: jest.requireActual('util').TextEncoder })
  const { renderToString } = jest.requireActual('react-dom/server') as typeof import('react-dom/server')
  const html = renderToString(<BudgetDashboard initialData={pageData()} userId="u1" />)
  expect(html).toContain(formatDateOnly(todayKey()))
  expect(html).not.toContain('Today')

  renderDashboard()
  expect(screen.getByText('Today')).toBeTruthy()
})

it('teens and children see rows but cannot open the edit form (the API is parent-only)', () => {
  render(
    <ToastProvider>
      <BudgetDashboard initialData={pageData()} userId="u1" canEdit={false} />
    </ToastProvider>
  )
  expect(screen.getByText('Groceries')).toBeTruthy()
  expect(screen.queryByRole('button', { name: /Groceries/ })).toBeNull()
})
