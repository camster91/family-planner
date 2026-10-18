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
  default: ({ onSuccess, onDeleted }: {
    onSuccess: (transaction?: unknown) => void
    onDeleted?: (transactionId?: string) => void
  }) => (
    <>
      <button type="button" data-testid="mock-transaction-success" onClick={() => onSuccess(mockSavedTransaction)}>
        Mock transaction saved
      </button>
      <button type="button" data-testid="mock-transaction-delete" onClick={() => onDeleted?.('tx-1')}>
        Mock transaction deleted
      </button>
    </>
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

const MOCK_SAVED_TRANSACTION = transaction({
  id: 'tx-saved',
  description: 'Confirmed saved row',
})

let mockSavedTransaction = MOCK_SAVED_TRANSACTION

const FULL_RECENT_WINDOW = Array.from({ length: 10 }, (_, index) =>
  transaction({
    id: `recent-${index}`,
    description: `Recent ${index}`,
    date: `2026-10-${String(18 - index).padStart(2, '0')}T00:00:00.000Z`,
  })
)

let fetchMock: jest.Mock

beforeEach(() => {
  mockSavedTransaction = MOCK_SAVED_TRANSACTION
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

it('renders canonical category spending with a bounded progress summary', () => {
  render(
    <BudgetDashboard
      initialData={pageData({
        category_breakdown: [
          { category_id: 'cat-food', name: 'Groceries', icon: '🛒', color: '#4ade80', budget_limit: 450, total: 312, percentage: 72 },
          { category_id: 'cat-fun', name: 'Activities', icon: '🎟️', color: '#c084fc', budget_limit: null, total: 120, percentage: 28 },
        ],
      })}
      userId="u1"
    />
  )

  expect(screen.getByRole('heading', { name: 'Spending by category' })).toBeTruthy()
  expect(screen.getByText('Groceries')).toBeTruthy()
  expect(screen.getByText('$312.00 of $450.00 limit')).toBeTruthy()
  expect(screen.getByText('Activities')).toBeTruthy()
  expect(screen.getByText('28% of expenses')).toBeTruthy()
  expect(screen.getByRole('progressbar', { name: 'Groceries' }).getAttribute('aria-valuenow')).toBe('69')
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

it('rejects impossible stats ranges without replacing known good data', async () => {
  const stale = pageData({ recent_transactions: [transaction()] })
  fetchMock = jest.fn().mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => pageData({
      category_breakdown: [{
        category_id: 'cat-food', name: 'Food', icon: 'F', color: '#f00',
        budget_limit: 100, total: 10, percentage: 101,
      }],
    }),
  })
  global.fetch = fetchMock as unknown as typeof fetch

  const user = userEvent.setup()
  render(<BudgetDashboard initialData={stale} userId="u1" />)
  await user.click(screen.getByRole('button', { name: 'Refresh budget' }))

  expect((await screen.findByRole('alert')).textContent).toContain('Showing saved rows')
  expect(screen.getByText('Still here')).toBeTruthy()
})

it('keeps the confirmed saved row and marks stale totals until a GET catches up', async () => {
  fetchMock = jest.fn().mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => pageData({ recent_transactions: [] }),
  })
  global.fetch = fetchMock as unknown as typeof fetch

  const user = userEvent.setup()
  render(<BudgetDashboard initialData={pageData({ recent_transactions: [] })} userId="u1" />)
  await user.click(screen.getAllByRole('button', { name: 'Add expense' })[0]!)
  await user.click(screen.getByTestId('mock-transaction-success'))

  expect(await screen.findByText('Confirmed saved row')).toBeTruthy()
  expect((await screen.findByRole('alert')).textContent).toContain('Transaction saved')
  expect(screen.getByRole('button', { name: 'Retry budget refresh' })).toBeTruthy()
})

it('accepts canonical aggregates when a confirmed backdated save falls outside the recent window', async () => {
  mockSavedTransaction = transaction({
    id: 'tx-saved',
    description: 'Confirmed saved row',
    date: '2026-09-01T00:00:00.000Z',
  })
  fetchMock = jest.fn().mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => pageData({
      total_expenses: 999,
      recent_transactions: FULL_RECENT_WINDOW,
    }),
  })
  global.fetch = fetchMock as unknown as typeof fetch

  const user = userEvent.setup()
  render(<BudgetDashboard initialData={pageData({ recent_transactions: [] })} userId="u1" />)
  await user.click(screen.getAllByRole('button', { name: 'Add expense' })[0]!)
  await user.click(screen.getByTestId('mock-transaction-success'))

  await waitFor(() => expect(screen.getByText('$999.00')).toBeTruthy())
  expect(screen.queryByText('Confirmed saved row')).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getByText('Recent 0')).toBeTruthy()
})

it('keeps a confirmed row when a full recent window could still contain it', async () => {
  mockSavedTransaction = transaction({
    id: 'tx-saved',
    description: 'Confirmed saved row',
    date: '2026-10-17T00:00:00.000Z',
  })
  fetchMock = jest.fn().mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => pageData({
      total_expenses: 999,
      recent_transactions: FULL_RECENT_WINDOW,
    }),
  })
  global.fetch = fetchMock as unknown as typeof fetch

  const user = userEvent.setup()
  render(<BudgetDashboard initialData={pageData({ recent_transactions: [] })} userId="u1" />)
  await user.click(screen.getAllByRole('button', { name: 'Add expense' })[0]!)
  await user.click(screen.getByTestId('mock-transaction-success'))

  expect(await screen.findByText('Confirmed saved row')).toBeTruthy()
  expect((await screen.findByRole('alert')).textContent).toContain('Transaction saved')
  expect(screen.getByRole('button', { name: 'Retry budget refresh' })).toBeTruthy()
})

it('keeps a confirmed save notice when stats returns 503 and retries only GET', async () => {
  fetchMock = jest
    .fn()
    .mockResolvedValueOnce({ ok: false, status: 503 })
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => pageData({ recent_transactions: [MOCK_SAVED_TRANSACTION] }) })
  global.fetch = fetchMock as unknown as typeof fetch

  const user = userEvent.setup()
  render(<BudgetDashboard initialData={pageData({ recent_transactions: [] })} userId="u1" />)
  await user.click(screen.getAllByRole('button', { name: 'Add expense' })[0]!)
  await user.click(screen.getByTestId('mock-transaction-success'))

  expect(await screen.findByText('Confirmed saved row')).toBeTruthy()
  expect((await screen.findByRole('alert')).textContent).toContain('Transaction saved')
  expect(fetchMock).toHaveBeenCalledTimes(1)
  await user.click(screen.getByRole('button', { name: 'Retry budget refresh' }))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  expect(fetchMock.mock.calls.map(([, init]) => init?.method ?? 'GET')).toEqual(['GET', 'GET'])
})

it('keeps a confirmed deletion out of stale stats rows and marks the summary', async () => {
  fetchMock = jest.fn().mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => pageData({ recent_transactions: [transaction()] }),
  })
  global.fetch = fetchMock as unknown as typeof fetch

  const user = userEvent.setup()
  render(<BudgetDashboard initialData={pageData({ recent_transactions: [transaction()] })} userId="u1" />)
  await user.click(screen.getByRole('button', { name: /Still here/ }))
  await user.click(screen.getByTestId('mock-transaction-delete'))

  expect(screen.queryByText('Still here')).toBeNull()
  expect((await screen.findByRole('alert')).textContent).toContain('Transaction deleted')
  expect(screen.getByRole('button', { name: 'Retry budget refresh' })).toBeTruthy()
})

it('keeps a confirmed deletion notice when stats returns 503 and retries only GET', async () => {
  fetchMock = jest
    .fn()
    .mockResolvedValueOnce({ ok: false, status: 503 })
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => pageData({ recent_transactions: [] }) })
  global.fetch = fetchMock as unknown as typeof fetch

  const user = userEvent.setup()
  render(<BudgetDashboard initialData={pageData({ recent_transactions: [transaction()] })} userId="u1" />)
  await user.click(screen.getByRole('button', { name: /Still here/ }))
  await user.click(screen.getByTestId('mock-transaction-delete'))

  expect(screen.queryByText('Still here')).toBeNull()
  expect((await screen.findByRole('alert')).textContent).toContain('Transaction deleted')
  expect(fetchMock).toHaveBeenCalledTimes(1)
  await user.click(screen.getByRole('button', { name: 'Retry budget refresh' }))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  expect(fetchMock.mock.calls.map(([, init]) => init?.method ?? 'GET')).toEqual(['GET', 'GET'])
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
  await user.click(screen.getAllByRole('button', { name: 'Add expense' })[0])
  await user.click(screen.getByTestId('mock-transaction-success'))
  expect(fetchMock).toHaveBeenCalledTimes(1)

  resolveFirst({ ok: true, status: 200, json: async () => pageData({ recent_transactions: [transaction()] }) } as Response)
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  expect(await screen.findByText('Fresh after save')).toBeTruthy()
})
