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
import type { BudgetPageData } from '@/app/dashboard/budget/page'

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

/** The viewer's local calendar month as `YYYY-MM`. */
function localYearMonth(now: Date = new Date()): string {
  return toDateOnlyLocal(now).slice(0, 7)
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(Math.abs(amount))
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
  const [data, setData] = React.useState(initialData)
  const [showForm, setShowForm] = React.useState(false)
  // The transaction open in the edit form.
  const [editing, setEditing] = React.useState<Transaction | null>(null)
  const hydrated = useHydrated()
  const { addToast } = useMaybeToast()
  const [filter, setFilter] = React.useState<'all' | 'income' | 'expense'>('all')
  const [isLoading, setIsLoading] = React.useState(false)

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
    setIsLoading(true)
    try {
      // Ask for the viewer's local month (O-31): without it the server picks
      // the UTC month, which is wrong for the hours around a month change.
      const res = await fetch(`/api/budget/stats?month=${localYearMonth()}`)
      if (res.ok) {
        const json = await res.json()
        setData({
          ...json,
          monthly_trend: json.monthly_trend,
          recent_transactions: json.recent_transactions,
          category_breakdown: json.category_breakdown,
        } as BudgetPageData)
      }
    } catch (err) {
      console.error('Failed to refresh:', err)
    } finally {
      setIsLoading(false)
    }
  }, [])

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
          <button onClick={refreshData} aria-label="Refresh budget" type="button" className={cn('btn-ghost h-11 w-11 p-0', isLoading && 'opacity-50')}>
            <RefreshCw aria-hidden="true" className={cn('w-4 h-4', isLoading && 'motion-safe:animate-spin')} />
          </button>
        }
        className="px-4"
      />

      <div className="space-y-5 px-4">
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
              {formatCurrency(spent)}
            </p>
            <p className="text-subhead text-label-secondary mt-0.5">
              {ring && budgetLimit !== null
                ? `of ${formatCurrency(budgetLimit)} limit`
                : 'spent this month'}
            </p>
            {ring?.over && (
              <p className="text-footnote text-[var(--tint-rewards-text)] mt-1 font-medium">
                Over budget by {formatCurrency(ring.overBy)}
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
              +{formatCurrency(data.total_income)}
            </p>
          </div>
          <div className="card-apple p-4">
            <p className="text-footnote text-label-secondary">Expenses</p>
            <p className="text-title-3 text-[var(--tint-rewards-text)] font-semibold mt-1">
              -{formatCurrency(data.total_expenses)}
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
                            {tx.type === 'income' ? '+' : '-'}{formatCurrency(tx.amount)}
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