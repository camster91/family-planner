import {
  createD1BudgetCategory,
  createD1BudgetTransaction,
  deleteD1BudgetCategory,
  deleteD1BudgetTransaction,
  readD1BudgetCategories,
  readD1BudgetStats,
  readD1BudgetTransactions,
  updateD1BudgetCategory,
  updateD1BudgetTransaction,
} from '../../../src/lib/cloudflare/budget'
import type { D1Store } from '../../../src/lib/cloudflare/database'

function check(value: unknown, label: string): asserts value {
  if (!value) throw new Error(label)
}

const parent = { userId: 'budget-parent', familyId: 'budget-family-a', role: 'parent', generation: 0 } as const
const child = { userId: 'budget-child', familyId: 'budget-family-a', role: 'child', generation: 0 } as const
const foreign = { userId: 'budget-foreign', familyId: 'budget-family-b', role: 'parent', generation: 0 } as const
const features = JSON.stringify({ budget: true })

/** Disposable native coverage for private parent-only budget workflows. */
export async function testBudget(db: D1Store) {
  const month = Date.parse('2026-10-15T12:00:00.000Z')
  const prior = Date.parse('2026-09-15T12:00:00.000Z')
  await db.batch([
    db.prepare(`INSERT INTO "Family"(id,name,invite_code,features) VALUES ('budget-family-a','Budget A','budget-code-a',?1),('budget-family-b','Budget B','budget-code-b',?1)`).bind(features),
    db.prepare(`INSERT INTO "User"(id,email,name,family_id,role,token_version) VALUES
      ('budget-parent','budget-parent@example.test','Budget Parent','budget-family-a','parent',0),
      ('budget-child','budget-child@example.test','Budget Child','budget-family-a','child',0),
      ('budget-foreign','budget-foreign@example.test','Other Parent','budget-family-b','parent',0)`),
    db.prepare(`INSERT INTO "BudgetCategory"(id,family_id,name,icon,color,type,budget_limit,created_by,created_at) VALUES ('budget-category','budget-family-a','Household','🏠','#22C55E','expense',500,'budget-parent',?1),('budget-foreign-category','budget-family-b','Other','📦','#6B7280','expense',100,'budget-foreign',?1)`).bind(prior),
    db.prepare(`INSERT INTO "Transaction"(id,family_id,user_id,amount,type,category_id,description,date,created_at,updated_at) VALUES ('budget-existing','budget-family-a','budget-parent',42.5,'expense','budget-category','Groceries',?1,?1,?1),('budget-prior','budget-family-a','budget-parent',100,'income',NULL,'Salary',?2,?2,?2),('budget-foreign-row','budget-family-b','budget-foreign',999,'expense','budget-foreign-category','Private',?2,?2,?2)`).bind(month, prior),
  ])

  const categories = await readD1BudgetCategories(parent, null, db)
  check(categories.status === 200 && (categories.body as any).categories[0]._count.transactions === 1, 'category read and count')
  check((await readD1BudgetCategories(child, null, db)).status === 403, 'child category read denied')
  check((await readD1BudgetTransactions(foreign, { type: null, categoryId: null, start: null, end: null, limit: 50, offset: 0 }, db)).body && (await readD1BudgetTransactions(foreign, { type: null, categoryId: null, start: null, end: null, limit: 50, offset: 0 }, db)).status === 200, 'foreign household has private budget')

  const createdCategory = await createD1BudgetCategory(parent, { name: 'Utilities', icon: '💡', color: '#F59E0B', type: 'expense', budget_limit: 250 }, db)
  check(createdCategory.status === 201, 'category create')
  check((await createD1BudgetCategory(parent, { name: 'utilities', type: 'expense' }, db)).status === 409, 'category duplicate')
  const categoryId = (createdCategory.body as any).category.id as string
  check((await updateD1BudgetCategory(parent, categoryId, { budget_limit: 300 }, db)).status === 200, 'category update')

  const input = { amount: 12.5, type: 'expense', category_id: categoryId, description: 'Coffee', notes: 'Family outing', date: '2026-10-20T12:00:00.000Z', is_recurring: false }
  const created = await createD1BudgetTransaction(parent, input, 'budget-create-key', db)
  check(created.status === 201 && (created.body as any).transaction?.family_id === parent.familyId, `transaction create status=${created.status} body=${JSON.stringify(created.body)}`)
  const replay = await createD1BudgetTransaction(parent, input, 'budget-create-key', db)
  check(replay.replayed && JSON.stringify(replay.body) === JSON.stringify(created.body), 'transaction create replay')
  const transactionId = (created.body as any).transaction.id as string
  check((await createD1BudgetTransaction(child, input, null, db)).status === 403, 'child transaction denied')
  check((await updateD1BudgetTransaction(foreign, transactionId, { amount: 15, transactionId }, null, db)).status === 404, 'foreign transaction hidden')
  const edited = await updateD1BudgetTransaction(parent, transactionId, { amount: 15, transactionId }, 'budget-update-key', db)
  check(edited.status === 200 && (edited.body as any).transaction.amount === 15, 'transaction update')
  check((await deleteD1BudgetTransaction(parent, transactionId, 'budget-delete-key', db)).status === 200, 'transaction delete')
  check((await deleteD1BudgetTransaction(parent, transactionId, 'budget-delete-key', db)).replayed, 'transaction delete replay')

  const stats = await readD1BudgetStats(parent, 2026, 10, db)
  check(stats.status === 200 && (stats.body as any).total_expenses === 42.5 && (stats.body as any).monthly_trend.length === 6, 'budget stats')
  check((await deleteD1BudgetCategory(parent, categoryId, db)).status === 200, 'category delete')
  check((await readD1BudgetCategories(parent, null, db)).status === 200, 'category remains readable')
  return { categories: true, transactions: true, receipts: true, stats: true, parentOnly: true, isolation: true }
}
