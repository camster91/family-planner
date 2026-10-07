/** @jest-environment jsdom */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import BudgetDashboard from '../BudgetDashboard'
import { toDateOnlyLocal } from '@/lib/dates'
import { serverRenderThenHydrate } from '@/components/ui/__tests__/ssr-hydration'

jest.mock('../TransactionForm', () => ({ __esModule: true, default: () => null }))

it('uses en-GB number style while retaining USD rather than switching to GBP', () => {
  const languages = jest.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-GB'])
  try {
    render(<BudgetDashboard userId="parent" initialData={{
      month: toDateOnlyLocal(new Date()).slice(0, 7),
      total_income: 2000, total_expenses: 1234.5, balance: 765.5, budget_limit: 2500,
      category_breakdown: [], recent_transactions: [], monthly_trend: [],
    }} />)
    expect(screen.getByText('US$1,234.50')).toBeTruthy()
    expect(screen.getByText('of US$2,500.00 limit')).toBeTruthy()
    expect(screen.getByText('+US$2,000.00')).toBeTruthy()
    expect(screen.queryByText(/£/)).toBeNull()
  } finally { languages.mockRestore() }
})

it('hydrates an en-GB device without mismatch before applying its regional money format', () => {
  const languages = jest.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-GB'])
  const now = new Date(2026, 9, 3, 12)
  jest.useFakeTimers()
  let hydrated: ReturnType<typeof serverRenderThenHydrate> | undefined
  try {
    hydrated = serverRenderThenHydrate(<BudgetDashboard userId="parent" initialData={{
      month: '2026-10', total_income: 0, total_expenses: 1234.5, balance: -1234.5, budget_limit: null,
      category_breakdown: [], recent_transactions: [], monthly_trend: [],
    }} />, { serverNow: now, clientNow: now })
    expect(hydrated.html).toContain('$1,234.50')
    expect(hydrated.html).not.toContain('US$1,234.50')
    expect(hydrated.errors).toEqual([])
    expect(hydrated.recoverable).toEqual([])
    expect(screen.getByText('US$1,234.50')).toBeTruthy()
  } finally {
    hydrated?.unmount()
    jest.useRealTimers()
    languages.mockRestore()
  }
})
