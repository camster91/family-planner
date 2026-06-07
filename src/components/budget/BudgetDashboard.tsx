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
import type { BudgetPageData } from '@/app/dashboard/budget/page'

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(Math.abs(amount))
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)

  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function groupByDate(transactions: Transaction[]): Record<string, Transaction[]> {
  const groups: Record<string, Transaction[]> = {}
  for (const tx of transactions) {
    const key = new Date(tx.date).toDateString()
    if (!groups[key]) groups[key] = []
    groups[key].push(tx)
  }
  return groups
}

// -----------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------

interface Transaction {
  id: string
  amount: number
  type: string
  description: string | null
  date: string
  is_recurring: boolean
  recurring_interval: string | null
  category: { id: string; name: string; icon: string; color: string } | null
  user: { id: string; name: string; avatar_url: string | null }
}

interface BudgetDashboardProps {
  initialData: BudgetPageData
  userId: string
}

// -----------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------

export default function BudgetDashboard({ initialData, userId }: BudgetDashboardProps) {
  const [data, setData] = React.useState(initialData)
  const [showForm, setShowForm] = React.useState(false)
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
  const sortedDates = Object.keys(grouped).sort(
    (a, b) => new Date(b).getTime() - new Date(a).getTime()
  )

  // Budget limit (default to 2000 if not set)
  const budgetLimit = 2000
  const spent = data.total_expenses
  const progress = budgetLimit > 0 ? Math.min(spent / budgetLimit, 1) : 0

  const refreshData = React.useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch('/api/budget/stats')
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

  const handleSuccess = React.useCallback(() => {
    setShowForm(false)
    refreshData()
  }, [refreshData])

  return (
    <div className="pb-20">
      <LargeHeader
        greeting="Family"
        title="Budget"
        subtitle={data.month}
        trailing={
          <button onClick={refreshData} aria-label="Refresh budget" className={cn('btn-ghost p-2', isLoading && 'opacity-50')}>
            <RefreshCw className={cn('w-4 h-4', isLoading && 'animate-spin')} />
          </button>
        }
        className="px-4"
      />

      <div className="space-y-5 px-4">
        {/* Progress ring + summary */}
        <div className="card-apple p-5 flex items-center gap-5">
          <ProgressRing
            progress={progress}
            size={80}
            strokeWidth={8}
            color={spent > budgetLimit ? 'var(--tint-rewards)' : 'var(--accent)'}
          >
            <span className="text-[28px] font-bold leading-none text-label-primary">
              {Math.round(progress * 100)}%
            </span>
          </ProgressRing>
          <div className="flex-1 min-w-0">
            <p className="text-title-3 text-label-primary font-semibold">
              {formatCurrency(spent)}
            </p>
            <p className="text-subhead text-label-secondary mt-0.5">
              of {formatCurrency(budgetLimit)} limit
            </p>
            {spent > budgetLimit && (
              <p className="text-footnote text-[var(--tint-rewards)] mt-1 font-medium">
                Over budget by {formatCurrency(spent - budgetLimit)}
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
            <p className="text-title-3 text-[var(--tint-lists)] font-semibold mt-1">
              +{formatCurrency(data.total_income)}
            </p>
          </div>
          <div className="card-apple p-4">
            <p className="text-footnote text-label-secondary">Expenses</p>
            <p className="text-title-3 text-[var(--tint-rewards)] font-semibold mt-1">
              -{formatCurrency(data.total_expenses)}
            </p>
          </div>
        </div>

        {/* Transactions grouped by date */}
        {sortedDates.length > 0 ? (
          sortedDates.map((dateKey) => {
            const txs = grouped[dateKey]
            const dateLabel = formatDate(dateKey)
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
                        showChevron={false}
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
      {showForm && (
        <TransactionForm
          onClose={() => setShowForm(false)}
          onSuccess={handleSuccess}
        />
      )}
    </div>
  )
}