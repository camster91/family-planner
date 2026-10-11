'use client'

import * as React from 'react'
import { Plus, RefreshCw, LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ProgressRing } from '@/components/ui/progress-ring'
import { InsetList, ListRow, SectionHeader } from '@/components/ui/list-row'
import { Glyph } from '@/components/ui/glyph'
import { EmptyState } from '@/components/ui/empty-state'
import { LargeHeader } from '@/components/ui/large-header'
import TransactionForm from './TransactionForm'
import { formatDateOnly, formatRelativePastDate, toDateOnlyLocal, toDateOnlyUTC } from '@/lib/dates'
import { useMaybeToast } from '@/components/ui/toast'
import { budgetProgress } from '@/lib/budget'
import { useDisplayLocale } from '@/components/ui/use-display-locale'
import { useBudgetText } from '@/i18n/budget'
import type { BudgetPageData } from '@/app/dashboard/budget/page'

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

/** The viewer's local calendar month as `YYYY-MM`. */
function localYearMonth(now: Date = new Date()): string {
  return toDateOnlyLocal(now).slice(0, 7)
}

function formatCurrency(amount: number, locale: string): string {
  // Locale controls presentation only. No household currency setting exists;
  // keep the canonical existing USD denomination, independent of the region.
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(Math.abs(amount))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isCategoryBreakdown(value: unknown): boolean {
  if (!isRecord(value)) return false
  return (
    (typeof value.category_id === 'string' || value.category_id === null) &&
    typeof value.name === 'string' &&
    typeof value.icon === 'string' &&
    typeof value.color === 'string' &&
    (value.budget_limit === null || isFiniteNumber(value.budget_limit)) &&
    isFiniteNumber(value.total) &&
    isFiniteNumber(value.percentage)
  )
}

function isRecentTransaction(value: unknown): boolean {
  if (!isRecord(value)) return false
  const category = value.category
  const user = value.user
  const validCategory =
    category === null ||
    (isRecord(category) &&
      typeof category.id === 'string' &&
      typeof category.name === 'string' &&
      typeof category.icon === 'string' &&
      typeof category.color === 'string')
  const validUser =
    isRecord(user) &&
    typeof user.id === 'string' &&
    typeof user.name === 'string' &&
    isNullableString(user.avatar_url)
  return (
    typeof value.id === 'string' &&
    isFiniteNumber(value.amount) &&
    typeof value.type === 'string' &&
    isNullableString(value.description) &&
    typeof value.date === 'string' &&
    typeof value.is_recurring === 'boolean' &&
    isNullableString(value.recurring_interval) &&
    validCategory &&
    validUser
  )
}

interface NormalizedBudgetData extends BudgetPageData {
  monthly_trend: BudgetPageData['monthly_trend']
}

/**
 * Validate the response before replacing the last known good dashboard.
 * The route intentionally omits `balance` on trend rows, so fill that
 * derived field while accepting the route's actual wire shape.
 */
function normalizeBudgetData(value: unknown): NormalizedBudgetData | null {
  if (!isRecord(value)) return null
  if (
    typeof value.month !== 'string' ||
    !isFiniteNumber(value.total_income) ||
    !isFiniteNumber(value.total_expenses) ||
    !isFiniteNumber(value.balance) ||
    (value.budget_limit !== null && !isFiniteNumber(value.budget_limit)) ||
    !Array.isArray(value.category_breakdown) ||
    !value.category_breakdown.every(isCategoryBreakdown) ||
    !Array.isArray(value.recent_transactions) ||
    !value.recent_transactions.every(isRecentTransaction) ||
    !Array.isArray(value.monthly_trend)
  ) {
    return null
  }

  const monthlyTrend = value.monthly_trend.map((entry) => {
    if (!isRecord(entry) || typeof entry.month !== 'string' || !isFiniteNumber(entry.income) || !isFiniteNumber(entry.expenses)) {
      return null
    }
    if ('balance' in entry && !isFiniteNumber(entry.balance)) return null
    return {
      month: entry.month,
      income: entry.income,
      expenses: entry.expenses,
      balance: 'balance' in entry ? entry.balance as number : entry.income - entry.expenses,
    }
  })

  if (monthlyTrend.some((entry) => entry === null)) return null
  return {
    month: value.month,
    total_income: value.total_income,
    total_expenses: value.total_expenses,
    balance: value.balance,
    budget_limit: value.budget_limit,
    category_breakdown: value.category_breakdown as BudgetPageData['category_breakdown'],
    recent_transactions: value.recent_transactions as BudgetPageData['recent_transactions'],
    monthly_trend: monthlyTrend as BudgetPageData['monthly_trend'],
  }
}

// Transaction dates are date-only values stored as UTC midnight. Group and
// label them by that UTC calendar day (`YYYY-MM-DD` keys): local getters would
// file them under the previous day west of UTC.
function groupByDate(transactions: Transaction[]): Record<string, Transaction[]> {
  const groups: Record<string, Transaction[]> = {}
  for (const tx of transactions) {
    const key = toDateOnlyUTC(tx.date)
    if (!groups[key]) groups[key] = []
    groups[key].push(tx)
  }
  return groups
}

const noopSubscribe = () => () => {}

/**
 * False during the server render and hydration, true after. "Today" and
 * "Yesterday" depend on the viewer's clock and time zone, so they are shown
 * only once hydrated; before that the label is the plain (UTC-stable) date.
 */
function useHydrated(): boolean {
  return React.useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  )
}

// -----------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------

interface Transaction {
  id: string
  amount: number
  type: string
  description: string | null
  notes?: string | null
  category_id?: string | null
  date: string
  is_recurring: boolean
  recurring_interval: string | null
  category: { id: string; name: string; icon: string; color: string } | null
  user: { id: string; name: string; avatar_url: string | null }
}

interface BudgetDashboardProps {
  initialData: BudgetPageData
  userId: string
  /** Only parents may edit or delete transactions (the API requires a parent). */
  canEdit?: boolean
}

// -----------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------

export default function BudgetDashboard({ initialData, userId, canEdit = true }: BudgetDashboardProps) {
  const displayLocale = useDisplayLocale()
  const [data, setData] = React.useState(initialData)
  const [showForm, setShowForm] = React.useState(false)
  // The transaction open in the edit form.
  const [editing, setEditing] = React.useState<Transaction | null>(null)
  const hydrated = useHydrated()
  const { addToast } = useMaybeToast()
  const text = useBudgetText()
  const [filter, setFilter] = React.useState<'all' | 'income' | 'expense'>('all')
  const [isLoading, setIsLoading] = React.useState(false)
  const [refreshError, setRefreshError] = React.useState<'server' | 'network' | null>(null)
  const refreshInFlight = React.useRef(false)
  const refreshQueued = React.useRef(false)
  const refreshDataRef = React.useRef<() => Promise<void>>(async () => {})

  // All transactions from the data
  const allTransactions = data.recent_transactions as Transaction[]

  // Filter
  const filteredTransactions = React.useMemo(() => {
    if (filter === 'all') return allTransactions
    return allTransactions.filter(t => t.type === filter)
  }, [allTransactions, filter])

  // Group by date
  const grouped = React.useMemo(() => groupByDate(filteredTransactions), [filteredTransactions])
  // `YYYY-MM-DD` keys sort chronologically as strings; newest first.
  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a))

  // Limit is the sum of the household's category limits; with none set the
  // card shows only what was spent (no ring, no made-up cap).
  const budgetLimit = data.budget_limit ?? null
  const spent = data.total_expenses
  const ring = budgetProgress(spent, budgetLimit)

  const refreshData = React.useCallback(async () => {
    if (refreshInFlight.current) {
      // A save/delete can finish while an older refresh is still resolving.
      // Keep that invalidation so the eventual response cannot win with stale
      // rows from before the mutation.
      refreshQueued.current = true
      return
    }
    refreshInFlight.current = true
    setIsLoading(true)
    setRefreshError(null)
    try {
      // Ask for the viewer's local month (O-31): without it the server picks
      // the UTC month, which is wrong for the hours around a month change.
      const res = await fetch(`/api/budget/stats?month=${localYearMonth()}`)
      if (!res.ok) {
        setRefreshError('server')
        return
      }
      const json = await res.json().catch(() => undefined)
      const nextData = normalizeBudgetData(json)
      if (!nextData) {
        setRefreshError('server')
        return
      }
      setData(nextData)
    } catch {
      setRefreshError('network')
    } finally {
      const shouldRefreshAgain = refreshQueued.current
      refreshQueued.current = false
      refreshInFlight.current = false
      if (shouldRefreshAgain) {
        void refreshDataRef.current()
      } else {
        setIsLoading(false)
      }
    }
  }, [])

  refreshDataRef.current = refreshData

  // The server renders the UTC month. If the viewer's local month differs
  // (e.g. the evening of the 31st west of UTC), load their month instead.
  React.useEffect(() => {
    if (initialData.month !== localYearMonth()) refreshData()
  }, [initialData.month, refreshData])

  const closeForm = React.useCallback(() => {
    setShowForm(false)
    setEditing(null)
  }, [])

  const handleSuccess = React.useCallback(() => {
    closeForm()
    refreshData()
  }, [closeForm, refreshData])

  const handleDeleted = React.useCallback(() => {
    closeForm()
    addToast({ type: 'success', title: 'Transaction deleted' })
    refreshData()
  }, [closeForm, addToast, refreshData])

  return (
    <div className="pb-20">
      <LargeHeader
        greeting="Family"
        title="Budget"
        subtitle={data.month}
        trailing={
          <button
            onClick={refreshData}
            aria-label={isLoading ? text('refreshingBudget') : text('refreshBudget')}
            aria-busy={isLoading}
            disabled={isLoading}
            type="button"
            className={cn('btn-ghost h-11 w-11 p-0', isLoading && 'opacity-50')}
          >
            <RefreshCw aria-hidden="true" className={cn('w-4 h-4', isLoading && 'motion-safe:animate-spin')} />
          </button>
        }
        className="px-4"
      />

      <div className="space-y-5 px-4">
        {refreshError && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--tint-rewards)] bg-[var(--tint-rewards)]/10 px-4 py-3">
            <p className="text-subhead text-label-primary">
              {refreshError === 'network' ? text('refreshNetworkError') : text('refreshFailed')}
            </p>
            <button
              type="button"
              onClick={refreshData}
              disabled={isLoading}
              className="btn-ghost min-h-[44px] shrink-0 px-3"
            >
              {text('retryRefresh')}
            </button>
          </div>
        )}

        {/* Progress ring + summary */}
        <div className="card-apple p-5 flex items-center gap-5">
          {ring && budgetLimit !== null && (
            <ProgressRing
              progress={ring.progress}
              size={80}
              strokeWidth={8}
              color={ring.over ? 'var(--tint-rewards)' : 'var(--accent)'}
            >
              <span className="text-[28px] font-bold leading-none text-label-primary">
                {Math.round(ring.progress * 100)}%
              </span>
            </ProgressRing>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-title-3 text-label-primary font-semibold">
              {formatCurrency(spent, displayLocale)}
            </p>
            <p className="text-subhead text-label-secondary mt-0.5">
              {ring && budgetLimit !== null
                ? `of ${formatCurrency(budgetLimit, displayLocale)} limit`
                : 'spent this month'}
            </p>
            {ring?.over && (
              <p className="text-footnote text-[var(--tint-rewards-text)] mt-1 font-medium">
                Over budget by {formatCurrency(ring.overBy, displayLocale)}
              </p>
            )}
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="btn-filled shrink-0"
            aria-label="Add transaction"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 gap-3">
          <div className="card-apple p-4">
            <p className="text-footnote text-label-secondary">Income</p>
            <p className="text-title-3 text-[var(--tint-lists-text)] font-semibold mt-1">
              +{formatCurrency(data.total_income, displayLocale)}
            </p>
          </div>
          <div className="card-apple p-4">
            <p className="text-footnote text-label-secondary">Expenses</p>
            <p className="text-title-3 text-[var(--tint-rewards-text)] font-semibold mt-1">
              -{formatCurrency(data.total_expenses, displayLocale)}
            </p>
          </div>
        </div>

        {/* Transactions grouped by date */}
        {sortedDates.length > 0 ? (
          sortedDates.map((dateKey) => {
            const txs = grouped[dateKey]
            const dateLabel = hydrated ? formatRelativePastDate(dateKey) : formatDateOnly(dateKey)
            return (
              <section key={dateKey}>
                <SectionHeader>{dateLabel}</SectionHeader>
                <InsetList>
                  {txs.map((tx, i) => {
                    const color = tx.category?.color || (tx.type === 'income' ? 'var(--tint-lists)' : 'var(--tint-rewards)')
                    return (
                      <ListRow
                        key={tx.id}
                        title={tx.description || tx.category?.name || (tx.type === 'income' ? 'Income' : 'Expense')}
                        subtitle={tx.category?.name || undefined}
                        glyphColor={tx.type === 'income' ? 'lists' : 'rewards'}
                        showChevron={canEdit}
                        onClick={canEdit ? () => setEditing(tx) : undefined}
                        trailing={
                          <span
                            className={cn(
                              'text-body font-semibold tabular-nums',
                              tx.type === 'income' ? 'text-[var(--tint-lists)]' : 'text-[var(--tint-rewards)]'
                            )}
                          >
                            {tx.type === 'income' ? '+' : '-'}{formatCurrency(tx.amount, displayLocale)}
                          </span>
                        }
                        last={i === txs.length - 1}
                      />
                    )
                  })}
                </InsetList>
              </section>
            )
          })
        ) : (
          <EmptyState
            icon={Plus}
            glyphColor="budget"
            title="No transactions"
            description="Add your first transaction to start tracking."
            action={
              <button onClick={() => setShowForm(true)} className="btn-filled">
                <Plus className="w-4 h-4" />
                <span>Add Transaction</span>
              </button>
            }
          />
        )}
      </div>

      {/* Modal form */}
      {(showForm || editing) && (
        <TransactionForm
          key={editing?.id ?? 'new'}
          initialData={editing}
          onClose={closeForm}
          onSuccess={handleSuccess}
          onDeleted={handleDeleted}
        />
      )}
    </div>
  )
}
