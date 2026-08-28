import { planBudgetAppImport } from '../budget-app'
import { importBudgetApp } from '../persist-budget-app'

const source = {
  version: '1',
  categories: [{ id: 'cat-1', name: ' Groceries ', type: 'EXPENSE', dailyCap: 5000, createdAt: '2026-08-01' }],
  transactions: [{ id: 'tx-1', amount: 1234, description: ' Market ', date: '2026-08-28', categoryId: 'cat-1', createdAt: '2026-08-28' }],
  wishlistItems: [{ id: 'wish-1', name: ' Bike ', price: 29999, priority: 'high', purchased: false, createdAt: '2026-08-20' }],
  accounts: [{ id: 'account-1', name: 'Chequing', balance: 10000 }],
  bills: [{ id: 'bill-1', name: 'Hydro', amount: 7500 }],
}

describe('planBudgetAppImport', () => {
  it('converts cents to dollars and preserves advanced finance records', () => {
    const plan = planBudgetAppImport(source, 'user-1')
    expect(plan.categories[0]).toMatchObject({ name: 'Groceries', createdBy: 'user-1' })
    expect(plan.transactions[0]).toMatchObject({ amount: 12.34, sourceCategoryId: 'cat-1' })
    expect(plan.wishlistItems[0]).toMatchObject({ title: 'Bike', approxPrice: 299.99 })
    expect(plan.archive).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceModel: 'accounts', sourceId: 'account-1' }),
      expect.objectContaining({ sourceModel: 'bills', sourceId: 'bill-1' }),
    ]))
  })

  it('keeps a transaction while reporting its missing category', () => {
    const invalidReference = { ...source, transactions: [{ ...source.transactions[0], categoryId: 'missing' }] }
    const plan = planBudgetAppImport(invalidReference, 'user-1')
    expect(plan.transactions[0].sourceCategoryId).toBeNull()
    expect(plan.skippedRecords[0]).toMatchObject({ sourceModel: 'Transaction', sourceId: 'tx-1' })
  })

  it('defaults to a database-free dry run', async () => {
    const result = await importBudgetApp(source, { familyId: 'family-1', startedBy: 'user-1' })
    expect(result.jobId).toBeNull()
    expect(result.plan.transactions).toHaveLength(1)
    expect(result.summary.created).toEqual({})
  })
})
