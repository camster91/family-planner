/**
 * @jest-environment jsdom
 */
// Budget page (route inventory F-2): with the `budget` feature off the server
// page renders the calm "is off" state and reads no transaction or category.
import * as React from 'react'
import { render, screen } from '@testing-library/react'

const mockPrisma = {
  user: { findUnique: jest.fn() },
  transaction: { groupBy: jest.fn(), findMany: jest.fn() },
  budgetCategory: { findMany: jest.fn() },
}
jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))
jest.mock('@/lib/supabase/server', () => ({
  getServerUser: async () => ({ id: 'u1', email: 'parent@example.test', role: 'parent', family_id: 'fam-a' }),
}))
jest.mock('next/navigation', () => ({ redirect: jest.fn() }))
jest.mock('@/components/budget/BudgetDashboard', () => ({
  __esModule: true,
  default: () => <div data-testid="budget-dashboard" />,
}))

import BudgetPage from '../page'
import { defaultFeatures } from '@/lib/features'

function familyWith(budget: boolean) {
  mockPrisma.user.findUnique.mockResolvedValue({
    id: 'u1',
    family_id: 'fam-a',
    name: 'Parent',
    role: 'parent',
    family: { features: { ...defaultFeatures(), budget } },
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockPrisma.transaction.groupBy.mockResolvedValue([])
  mockPrisma.transaction.findMany.mockResolvedValue([])
  mockPrisma.budgetCategory.findMany.mockResolvedValue([])
})

it('shows the off state and reads no budget data when Budget is off', async () => {
  familyWith(false)
  render(await BudgetPage())
  expect(screen.getByRole('heading', { name: 'Budget is off' })).toBeTruthy()
  expect(screen.getByRole('link', { name: /Open Features/ }).getAttribute('href')).toBe('/dashboard/features')
  expect(screen.queryByTestId('budget-dashboard')).toBeNull()
  expect(mockPrisma.transaction.groupBy).not.toHaveBeenCalled()
  expect(mockPrisma.transaction.findMany).not.toHaveBeenCalled()
  expect(mockPrisma.budgetCategory.findMany).not.toHaveBeenCalled()
})

it('renders the dashboard when Budget is on', async () => {
  familyWith(true)
  render(await BudgetPage())
  expect(screen.getByTestId('budget-dashboard')).toBeTruthy()
  expect(screen.queryByText('Budget is off')).toBeNull()
  expect(mockPrisma.transaction.groupBy).toHaveBeenCalled()
})
