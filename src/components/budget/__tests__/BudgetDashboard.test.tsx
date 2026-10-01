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

jest.mock('../TransactionForm', () => ({ __esModule: true, default: () => null }))

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
