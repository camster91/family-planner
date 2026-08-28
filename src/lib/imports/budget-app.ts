import { z } from 'zod'

const dateValue = z.union([z.string(), z.date()]).transform((value, context) => {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) { context.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid date' }); return z.NEVER }
  return date
})
const archiveRecord = z.object({ id: z.string().min(1) }).passthrough()

export const budgetAppExportSchema = z.object({
  version: z.string().min(1),
  categories: z.array(z.object({
    id: z.string().min(1), name: z.string().min(1), icon: z.string().nullish(), color: z.string().nullish(),
    type: z.string().default('expense'), dailyCap: z.number().int().nullish(), parentId: z.string().nullish(),
    rules: z.string().nullish(), createdAt: dateValue,
  })).default([]),
  transactions: z.array(z.object({
    id: z.string().min(1), amount: z.number().int(), description: z.string(), date: dateValue,
    type: z.string().default('expense'), categoryId: z.string().nullish(), isRecurring: z.boolean().default(false),
    recurringId: z.string().nullish(), isDiscretionary: z.boolean().default(true), isTransfer: z.boolean().default(false),
    statementId: z.string().nullish(), reconciled: z.boolean().default(false), isDuplicate: z.boolean().default(false),
    duplicateOfId: z.string().nullish(), fingerprint: z.string().nullish(), source: z.string().nullish(),
    accountId: z.string().nullish(), billId: z.string().nullish(), createdAt: dateValue,
  })).default([]),
  wishlistItems: z.array(z.object({
    id: z.string().min(1), name: z.string().min(1), price: z.number().int().nonnegative(), link: z.string().nullish(),
    priority: z.string().default('medium'), purchased: z.boolean().default(false), createdAt: dateValue,
  })).default([]),
  accounts: z.array(archiveRecord).default([]), bills: z.array(archiveRecord).default([]),
  billPayments: z.array(archiveRecord).default([]), budgets: z.array(archiveRecord).default([]),
  goals: z.array(archiveRecord).default([]), goalContributions: z.array(archiveRecord).default([]),
  incomes: z.array(archiveRecord).default([]), screenshotReceipts: z.array(archiveRecord).default([]),
  spendingPatterns: z.array(archiveRecord).default([]), dailyPeriods: z.array(archiveRecord).default([]),
  noSpendEntries: z.array(archiveRecord).default([]),
})

const archiveFields = ['accounts', 'bills', 'billPayments', 'budgets', 'goals', 'goalContributions', 'incomes',
  'screenshotReceipts', 'spendingPatterns', 'dailyPeriods', 'noSpendEntries'] as const

export function planBudgetAppImport(input: unknown, importedBy: string) {
  const source = budgetAppExportSchema.parse(input)
  const categoryIds = new Set(source.categories.map((item) => item.id))
  const skippedRecords: Array<{ sourceModel: string; sourceId: string; reason: string }> = []
  const transactions = source.transactions.map((item) => {
    const categoryId = item.categoryId && categoryIds.has(item.categoryId) ? item.categoryId : null
    if (item.categoryId && !categoryId) skippedRecords.push({ sourceModel: 'Transaction', sourceId: item.id, reason: `Missing source category ${item.categoryId}` })
    return { sourceId: item.id, userId: importedBy, amount: item.amount / 100, description: item.description.trim() || null,
      date: item.date, type: item.type.toLowerCase(), sourceCategoryId: categoryId, isRecurring: item.isRecurring,
      createdAt: item.createdAt, metadata: { cents: item.amount, recurringId: item.recurringId, isDiscretionary: item.isDiscretionary,
        isTransfer: item.isTransfer, statementId: item.statementId, reconciled: item.reconciled, isDuplicate: item.isDuplicate,
        duplicateOfId: item.duplicateOfId, fingerprint: item.fingerprint, source: item.source,
        sourceAccountId: item.accountId, sourceBillId: item.billId } }
  })
  const archive = archiveFields.flatMap((field) => source[field].map((record) => ({
    sourceModel: field, sourceId: record.id, payload: record,
  })))
  return {
    sourceVersion: source.version,
    categories: source.categories.map((item) => ({ sourceId: item.id, name: item.name.trim(), icon: item.icon || '📦',
      color: item.color || '#6B7280', type: item.type.toLowerCase(), createdBy: importedBy, createdAt: item.createdAt,
      metadata: { dailyCapCents: item.dailyCap, sourceParentId: item.parentId, rules: item.rules } })),
    transactions,
    wishlistItems: source.wishlistItems.map((item) => ({ sourceId: item.id, requestedBy: importedBy, title: item.name.trim(),
      link: item.link || null, approxPrice: item.price / 100, status: item.purchased ? 'received' : 'idle',
      description: `Imported priority: ${item.priority}`, createdAt: item.createdAt })),
    archive,
    skippedRecords,
  }
}

export type BudgetAppImportPlan = ReturnType<typeof planBudgetAppImport>
