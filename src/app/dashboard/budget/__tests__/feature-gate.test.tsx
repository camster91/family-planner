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
const mockServerActor = jest.fn()
jest.mock('@/lib/supabase/server', () => ({ getServerActor: () => mockServerActor() }))
jest.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`) } }))
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
    token_version: 3,
    family: { features: { ...defaultFeatures(), budget } },
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockPrisma.user.findUnique.mockReset()
  mockServerActor.mockReset().mockResolvedValue({ id: 'u1', email: 'parent@example.test', role: 'parent', family_id: 'fam-a', tokenVersion: 3 })
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

// Source cases authored/unrun; layout middleware is deliberately not mounted.
it.each(['child', 'teen', 'unknown'])('refuses a %s person before finance or profile queries', async role => {
  mockServerActor.mockResolvedValueOnce({ id: 'u1', role, family_id: 'fam-a', tokenVersion: 3 })
  await expect(BudgetPage()).rejects.toThrow('redirect:/dashboard')
  expect(mockPrisma.user.findUnique).not.toHaveBeenCalled()
  expect(mockPrisma.transaction.groupBy).not.toHaveBeenCalled()
  expect(mockPrisma.budgetCategory.findMany).not.toHaveBeenCalled()
})
it('refuses an absent person session (including paired-device refusal) before reads', async () => {
  mockServerActor.mockResolvedValueOnce(null)
  await expect(BudgetPage()).rejects.toThrow('redirect:/login')
  expect(mockPrisma.user.findUnique).not.toHaveBeenCalled()
  expect(mockPrisma.transaction.groupBy).not.toHaveBeenCalled()
})
it.each([
  { change: { role: 'child' }, redirect: '/dashboard' },
  { change: { family_id: 'fam-b' }, redirect: '/dashboard' },
  { change: { token_version: 4 }, redirect: '/login' },
])('holds changed initial database authority before finance reads: $change', async ({ change, redirect }) => {
  familyWith(true)
  const initial = await mockPrisma.user.findUnique()
  mockPrisma.user.findUnique.mockResolvedValue({ ...initial, ...change })
  await expect(BudgetPage()).rejects.toThrow(`redirect:${redirect}`)
  expect(mockPrisma.transaction.groupBy).not.toHaveBeenCalled()
  expect(mockPrisma.transaction.findMany).not.toHaveBeenCalled()
  expect(mockPrisma.budgetCategory.findMany).not.toHaveBeenCalled()
})
it.each([
  { change: { role: 'teen' }, redirect: '/dashboard' },
  { change: { family_id: 'fam-b' }, redirect: '/dashboard' },
  { change: { token_version: 4 }, redirect: '/login' },
])('does not render finance after authority changes during aggregates: $change', async ({ change, redirect }) => {
  familyWith(true)
  const initial = await mockPrisma.user.findUnique()
  mockPrisma.user.findUnique.mockReset().mockResolvedValueOnce(initial).mockResolvedValueOnce({ ...initial, ...change })
  await expect(BudgetPage()).rejects.toThrow(`redirect:${redirect}`)
  expect(mockPrisma.transaction.groupBy).toHaveBeenCalled()
  for (const [query] of mockPrisma.transaction.groupBy.mock.calls) expect(query.where.family_id).toBe('fam-a')
  expect(screen.queryByTestId('budget-dashboard')).toBeNull()
})
it('uses the off state if Budget is disabled while finance reads are pending', async () => {
  familyWith(true)
  const initial = await mockPrisma.user.findUnique()
  mockPrisma.user.findUnique.mockReset().mockResolvedValueOnce(initial)
    .mockResolvedValueOnce({ ...initial, family: { features: { ...defaultFeatures(), budget: false } } })
  render(await BudgetPage())
  expect(screen.getByRole('heading', { name: 'Budget is off' })).toBeTruthy()
  expect(screen.queryByTestId('budget-dashboard')).toBeNull()
})
