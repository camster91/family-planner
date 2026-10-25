/** Private read-only archive metadata; never normalized money or owner proof. */
import { z } from 'zod'
export const FINANCE_ARCHIVE_MODELS = ['accounts', 'bills', 'billPayments', 'budgets', 'goals', 'goalContributions', 'incomes', 'screenshotReceipts', 'spendingPatterns', 'dailyPeriods', 'noSpendEntries'] as const
export const financeArchiveModel = z.enum([...FINANCE_ARCHIVE_MODELS, 'other'])
export type FinanceArchiveModel = z.infer<typeof financeArchiveModel>
export const FINANCE_ARCHIVE_PROTOCOL = 'herewoven.finance-archive.v1'
export const FINANCE_ARCHIVE_OWNER_HEADER = 'X-Herewoven-Finance-Owner'
export const financeArchiveOwner = z.object({ userId: z.string().min(1).max(128), familyId: z.string().min(1).max(128), generation: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict()
export type FinanceArchiveOwner = z.infer<typeof financeArchiveOwner>
const count = z.string().regex(/^(0|[1-9][0-9]{0,19})$/)
export const financeArchivePage = z.object({
  protocol: z.literal(FINANCE_ARCHIVE_PROTOCOL), owner: financeArchiveOwner,
  model: financeArchiveModel.nullable(),
  counts: z.array(z.object({ model: financeArchiveModel, count }).strict()).length(12),
  rows: z.array(z.object({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), createdAt: z.string().datetime(),
    sourceApp: z.string().max(160).refine(value => [...value].length <= 80), sourceModel: z.string().max(160).refine(value => [...value].length <= 80), sourceId: z.string().max(320).refine(value => [...value].length <= 160),
    sourceLabelsTruncated: z.boolean(),
  }).strict()).max(24),
  nextCursor: z.string().regex(/^[A-Za-z0-9_-]{1,1024}$/).nullable(),
}).strict().refine(value => new Set(value.counts.map(row => row.model)).size === 12 && new Set(value.rows.map(row => row.id)).size === value.rows.length, 'Archive page identities must be unique')
export type FinanceArchivePage = z.infer<typeof financeArchivePage>
