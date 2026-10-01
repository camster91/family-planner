/**
 * Shared budget helpers for the server page, the stats API and the client
 * dashboard. Client-safe: no Prisma or server-only imports.
 */

/** How many recent transactions the budget page and `/api/budget/stats` return. */
export const RECENT_TRANSACTIONS_LIMIT = 10

/**
 * The household's monthly spending limit: the sum of every expense
 * category's `budget_limit`. Returns null when no category has a positive
 * limit, so the dashboard shows only what was spent instead of a made-up cap.
 */
export function sumBudgetLimits(categories: Array<{ budget_limit: number | null }>): number | null {
  let total = 0
  let any = false
  for (const c of categories) {
    if (typeof c.budget_limit === 'number' && Number.isFinite(c.budget_limit) && c.budget_limit > 0) {
      total += c.budget_limit
      any = true
    }
  }
  return any ? Math.round(total * 100) / 100 : null
}

/** Ring progress (0..1) and overage for `spent` against an optional limit; null when there is no limit. */
export function budgetProgress(
  spent: number,
  limit: number | null
): { progress: number; over: boolean; overBy: number } | null {
  if (limit === null || limit <= 0) return null
  const over = spent > limit
  return {
    progress: Math.min(Math.max(spent / limit, 0), 1),
    over,
    overBy: over ? Math.round((spent - limit) * 100) / 100 : 0,
  }
}
