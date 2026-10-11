/**
 * @jest-environment jsdom
 */
// Budget summary card: the limit comes from the household's category limits
// (it used to be a hard-coded $2,000), and refresh asks for the viewer's local
// month instead of letting the server pick the UTC month.
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toDateOnlyLocal } from '@/lib/dates'
import type { BudgetPageData } from '@/app/dashboard/budget/page'

jest.mock('../TransactionForm', () => ({
  __esModule: true,
  default: ({ onSuccess }: { onSuccess: () => void }) => (
    <button type="button" data-testid="mock-transaction-success" onClick={onSuccess}>
      Mock transaction saved
    </button>
  ),
}))

import BudgetDashboard from '../BudgetDashboard'

const localMonth = () => toDateOnlyLocal(new Date()).slice(0, 7)

function pageData(overrides: Partial<BudgetPageData> = {}): BudgetPageData {
  return {
    month: localMonth(),
    total_income: 0,
    total_expenses: 300,
    balance: -300,
    budget_limit: null,
    category_breakdown: [],
    recent_transactions: [],
    monthly_trend: [],
    ...overrides,
  }
}

function transaction(overrides: Partial<BudgetPageData['recent_transactions'][number]> = {}) {
  return {
    id: 'tx-1',
    amount: 42,
    type: 'expense',
    description: 'Still here',
    notes: null,
    category_id: null,
    date: '2026-10-09T00:00:00.000Z',
    is_recurring: false,
    recurring_interval: null,
    category: null,
    user: { id: 'u1', name: 'Cameron', avatar_url: null },
    ...overrides,
  }
}

let fetchMock: jest.Mock

beforeEach(() => {
  fetchMock = jest.fn(async () => ({ ok: true, json: async () => pageData() }))
  global.fetch = fetchMock as unknown as typeof fetch
})

it('shows the household limit from the category limits', () => {
  render(<BudgetDashboard initialData={pageData({ budget_limit: 1200 })} userId="u1" />)
  expect(screen.getByText('of $1,200.00 limit')).toBeTruthy()
  expect(screen.getByText('25%')).toBeTruthy()
  expect(screen.queryByText(/2,000/)).toBeNull()
  expect(screen.queryByText(/Over budget/)).toBeNull()
})

it('says how far over the limit spending is', () => {
  render(<BudgetDashboard initialData={pageData({ budget_limit: 250 })} userId="u1" />)
  expect(screen.getByText('100%')).toBeTruthy()
  expect(screen.getByText('Over budget by $50.00')).toBeTruthy()
})

it('shows only the total spent when no category has a limit', () => {
  render(<BudgetDashboard initialData={pageData({ budget_limit: null })} userId="u1" />)
  expect(screen.getByText('$300.00')).toBeTruthy()
  expect(screen.getByText('spent this month')).toBeTruthy()
  expect(screen.queryByText(/limit/)).toBeNull()
  expect(screen.queryByText(/%$/)).toBeNull()
  expect(screen.queryByText(/Over budget/)).toBeNull()
})

it('refreshes the viewer’s local month', async () => {
  render(<BudgetDashboard initialData={pageData()} userId="u1" />)
  expect(fetchMock).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Refresh budget' }))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/budget/stats?month=${localMonth()}`))
})

it('loads the local month when the server rendered a different (UTC) month', async () => {
  render(<BudgetDashboard initialData={pageData({ month: '1999-01' })} userId="u1" />)
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/budget/stats?month=${localMonth()}`))
})

it('keeps existing rows and offers a retry when a refresh response is not ok', async () => {
  const stale = pageData({ recent_transactions: [transaction()] })
  fetchMock = jest
    .fn()
    .mockResolvedValueOnce({ ok: false, status: 503 })
    .mockResolvedValueOnce({ ok: true, json: async () => pageData({ recent_transactions: [] }) })
  global.fetch = fetchMock as unknown as typeof fetch

  const user = userEvent.setup()
  render(<BudgetDashboard initialData={stale} userId="u1" />)
  await user.click(screen.getByRole('button', { name: 'Refresh budget' }))

  expect((await screen.findByRole('alert')).textContent).toContain('Showing saved rows')
  expect(screen.getByText('Still here')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Retry budget refresh' }))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
})

it('shows a connection recovery message without clearing the current budget', async () => {
  const stale = pageData({ recent_transactions: [transaction()] })
  fetchMock = jest.fn().mockRejectedValueOnce(new Error('offline'))
  global.fetch = fetchMock as unknown as typeof fetch

  const user = userEvent.setup()
  render(<BudgetDashboard initialData={stale} userId="u1" />)
  await user.click(screen.getByRole('button', { name: 'Refresh budget' }))

  expect((await screen.findByRole('alert')).textContent).toContain('Check your connection')
  expect(screen.getByText('Still here')).toBeTruthy()
})

it('keeps saved rows when a successful refresh has invalid JSON or shape', async () => {
  const stale = pageData({ recent_transactions: [transaction()] })
  fetchMock = jest
    .fn()
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new Error('invalid json') } })
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })
  global.fetch = fetchMock as unknown as typeof fetch

  const user = userEvent.setup()
  render(<BudgetDashboard initialData={stale} userId="u1" />)
  await user.click(screen.getByRole('button', { name: 'Refresh budget' }))

  expect((await screen.findByRole('alert')).textContent).toContain('Showing saved rows')
  expect(screen.getByText('Still here')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Retry budget refresh' }))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  expect(screen.getByText('Still here')).toBeTruthy()
})

it('allows only one budget refresh while the current request is pending', async () => {
  let resolveRefresh: (value: { ok: boolean; json: () => Promise<BudgetPageData> }) => void = () => {}
  fetchMock = jest.fn(
    () =>
      new Promise((resolve) => {
        resolveRefresh = resolve
      })
  )
  global.fetch = fetchMock as unknown as typeof fetch

  const user = userEvent.setup()
  render(<BudgetDashboard initialData={pageData()} userId="u1" />)
  const refresh = screen.getByRole('button', { name: 'Refresh budget' })
  await user.click(refresh)

  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect((screen.getByRole('button', { name: 'Refreshing budget' }) as HTMLButtonElement).disabled).toBe(true)
  resolveRefresh({ ok: true, json: async () => pageData() })
  await waitFor(() => expect((screen.getByRole('button', { name: 'Refresh budget' }) as HTMLButtonElement).disabled).toBe(false))
})

it('queues a fresh refresh when a save finishes during an older refresh', async () => {
  let resolveFirst: (value: Response) => void = () => {}
  const fresh = pageData({ recent_transactions: [transaction({ id: 'tx-fresh', description: 'Fresh after save' })] })
  fetchMock = jest
    .fn()
    .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveFirst = resolve }))
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => fresh })
  global.fetch = fetchMock as unknown as typeof fetch

  const user = userEvent.setup()
  render(<BudgetDashboard initialData={pageData()} userId="u1" />)
  await user.click(screen.getByRole('button', { name: 'Refresh budget' }))
  await user.click(screen.getByRole('button', { name: 'Add transaction' }))
  await user.click(screen.getByTestId('mock-transaction-success'))
  expect(fetchMock).toHaveBeenCalledTimes(1)

  resolveFirst({ ok: true, status: 200, json: async () => pageData({ recent_transactions: [transaction()] }) } as Response)
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  expect(await screen.findByText('Fresh after save')).toBeTruthy()
})
