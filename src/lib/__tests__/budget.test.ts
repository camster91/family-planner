import { budgetProgress, sumBudgetLimits } from '@/lib/budget'

describe('sumBudgetLimits', () => {
  it('sums the positive category limits', () => {
    expect(sumBudgetLimits([{ budget_limit: 500 }, { budget_limit: 250.5 }, { budget_limit: null }])).toBe(750.5)
  })

  it('returns null when no category has a limit (no made-up cap)', () => {
    expect(sumBudgetLimits([])).toBeNull()
    expect(sumBudgetLimits([{ budget_limit: null }, { budget_limit: 0 }])).toBeNull()
  })

  it('ignores zero, negative and non-finite limits', () => {
    expect(sumBudgetLimits([{ budget_limit: -5 }, { budget_limit: NaN }, { budget_limit: 40 }])).toBe(40)
  })
})

describe('budgetProgress', () => {
  it('is null without a limit', () => {
    expect(budgetProgress(120, null)).toBeNull()
    expect(budgetProgress(120, 0)).toBeNull()
  })

  it('reports progress under the limit', () => {
    expect(budgetProgress(250, 1000)).toEqual({ progress: 0.25, over: false, overBy: 0 })
  })

  it('caps progress at 1 and reports the overage', () => {
    expect(budgetProgress(1300.25, 1000)).toEqual({ progress: 1, over: true, overBy: 300.25 })
  })
})
