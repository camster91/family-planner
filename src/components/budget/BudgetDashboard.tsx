'use client'

import { useState, useCallback, useEffect } from 'react'
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  Plus,
  RefreshCw,
  Receipt,
  Tag,
  ArrowUpRight,
  ArrowDownRight,
  Repeat,
} from 'lucide-react'
import { cn, formatDate } from '@/lib/utils'
import TransactionForm from './TransactionForm'
import CategoryManager from './CategoryManager'
import type { BudgetPageData } from '@/app/dashboard/budget/page'

interface BudgetDashboardProps {
  initialData: BudgetPageData
  userId: string
}

// Month label helper
const monthLabels = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

function formatMonthLabel(monthStr: string): string {
  const [year, month] = monthStr.split('-')
  return `${monthLabels[parseInt(month, 10) - 1]} ${year.slice(2)}`
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(amount)
}

type FilterType = 'all' | 'income' | 'expense'

interface Transaction {
  id: string
  amount: number
  type: string
  description: string | null
  date: string
  is_recurring: boolean
  recurring_interval: string | null
  category: {
    id: string
    name: string
    icon: string
    color: string
  } | null
  user: {
    id: string
    name: string
    avatar_url: string | null
  }
}

export default function BudgetDashboard({ initialData, userId }: BudgetDashboardProps) {
  const [data, setData] = useState(initialData)
  const [showTransactionForm, setShowTransactionForm] = useState(false)
  const [showCategoryManager, setShowCategoryManager] = useState(false)
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null)
  const [filter, setFilter] = useState<FilterType>('all')
  const [isLoading, setIsLoading] = useState(false)
  const [transactions, setTransactions] = useState<Transaction[]>(
    initialData.recent_transactions as Transaction[]
  )
  const [transactionsTotal, setTransactionsTotal] = useState(10)
  const [transactionsOffset, setTransactionsOffset] = useState(0)

  // Format data helpers
  const income = data.total_income
  const expenses = data.total_expenses
  const balance = data.balance

  // Find max bar height for monthly trend
  const trendMax = Math.max(
    ...data.monthly_trend.map((m) => Math.max(m.income, m.expenses)),
    1
  )

  // Fetch transactions with filters
  const fetchTransactions = useCallback(async () => {
    setIsLoading(true)
    try {
      const params = new URLSearchParams()
      if (filter !== 'all') params.set('type', filter)
      params.set('limit', '50')
      const res = await fetch(`/api/budget/transactions?${params}`)
      if (res.ok) {
        const json = await res.json()
        setTransactions(json.transactions)
        setTransactionsTotal(json.total)
        setTransactionsOffset(json.offset)
      }
    } catch (err) {
      console.error('Failed to fetch transactions:', err)
    } finally {
      setIsLoading(false)
    }
  }, [filter])

  // Re-fetch when filter changes
  useEffect(() => {
    if (filter !== 'all') {
      fetchTransactions()
    } else {
      // Reset to initial data filtered
      setTransactions(initialData.recent_transactions as Transaction[])
    }
  }, [filter, fetchTransactions, initialData.recent_transactions])

  // Refresh all data
  const refreshData = useCallback(async () => {
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
        })
        if (filter === 'all') {
          setTransactions(json.recent_transactions)
        }
      }
    } catch (err) {
      console.error('Failed to refresh:', err)
    } finally {
      setIsLoading(false)
    }
  }, [filter])

  const handleTransactionCreated = useCallback(() => {
    refreshData()
    setShowTransactionForm(false)
    setEditingTransaction(null)
  }, [refreshData])

  const handleTransactionDeleted = useCallback(
    async (id: string) => {
      try {
        await fetch(`/api/budget/transactions/${id}`, { method: 'DELETE' })
        refreshData()
      } catch (err) {
        console.error('Failed to delete:', err)
      }
    },
    [refreshData]
  )

  const handleEditTransaction = (tx: Transaction) => {
    setEditingTransaction(tx)
    setShowTransactionForm(true)
  }

  // Display transactions — all from filtered set
  const displayTransactions = filter === 'all'
    ? transactions.slice(0, 10)
    : transactions.slice(0, 50)

  // Cast editing transaction to match TransactionForm props
  const formInitialData = editingTransaction
    ? {
        id: editingTransaction.id,
        amount: editingTransaction.amount,
        type: editingTransaction.type,
        category_id: editingTransaction.category?.id ?? null,
        description: editingTransaction.description,
        notes: null as string | null,
        date: editingTransaction.date,
        is_recurring: editingTransaction.is_recurring,
        recurring_interval: editingTransaction.recurring_interval,
        category: editingTransaction.category,
      }
    : null

  return (
    <div className="space-y-6 pb-20">
      {/* Page Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Budget</h1>
          <p className="mt-1.5 text-gray-500">
            Track income, expenses, and family spending
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCategoryManager(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 hover:border-gray-300 transition-colors shadow-sm"
          >
            <Tag className="w-4 h-4" />
            <span className="hidden sm:inline">Categories</span>
          </button>
          <button
            onClick={refreshData}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 hover:border-gray-300 transition-colors shadow-sm',
              isLoading && 'opacity-50 pointer-events-none'
            )}
          >
            <RefreshCw className={cn('w-4 h-4', isLoading && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Income Card */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between mb-3">
            <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-emerald-600" />
            </div>
            <ArrowUpRight className="w-4 h-4 text-emerald-400" />
          </div>
          <p className="text-sm font-medium text-gray-500">Income</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">
            {formatCurrency(income)}
          </p>
          <p className="text-xs text-gray-400 mt-1">This month</p>
        </div>

        {/* Expenses Card */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between mb-3">
            <div className="w-10 h-10 bg-rose-50 rounded-xl flex items-center justify-center">
              <TrendingDown className="w-5 h-5 text-rose-600" />
            </div>
            <ArrowDownRight className="w-4 h-4 text-rose-400" />
          </div>
          <p className="text-sm font-medium text-gray-500">Expenses</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">
            {formatCurrency(expenses)}
          </p>
          <p className="text-xs text-gray-400 mt-1">This month</p>
        </div>

        {/* Balance Card */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 hover:shadow-md transition-shadow sm:col-span-1">
          <div className="flex items-center justify-between mb-3">
            <div
              className={cn(
                'w-10 h-10 rounded-xl flex items-center justify-center',
                balance >= 0 ? 'bg-blue-50' : 'bg-amber-50'
              )}
            >
              <Wallet
                className={cn(
                  'w-5 h-5',
                  balance >= 0 ? 'text-blue-600' : 'text-amber-600'
                )}
              />
            </div>
            <div
              className={cn(
                'text-xs font-semibold px-2 py-0.5 rounded-full',
                balance >= 0
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-rose-50 text-rose-700'
              )}
            >
              {balance >= 0 ? 'Surplus' : 'Deficit'}
            </div>
          </div>
          <p className="text-sm font-medium text-gray-500">Balance</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">
            {formatCurrency(balance)}
          </p>
          <p className="text-xs text-gray-400 mt-1">Income − Expenses</p>
        </div>
      </div>

      {/* Monthly Trend Chart */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Receipt className="w-5 h-5 text-indigo-500" />
            Monthly Trend
          </h3>
          <span className="text-xs text-gray-400">Last 6 months</span>
        </div>

        <div className="grid grid-cols-6 gap-3 items-end h-48">
          {data.monthly_trend.map((month, idx) => {
            const incomeHeight = trendMax > 0 ? (month.income / trendMax) * 100 : 0
            const expenseHeight = trendMax > 0 ? (month.expenses / trendMax) * 100 : 0
            const isCurrent = idx === data.monthly_trend.length - 1

            return (
              <div key={month.month} className="flex flex-col items-center gap-2 h-full justify-end">
                {/* Bar group */}
                <div className="w-full flex flex-col items-center gap-1 justify-end" style={{ height: '140px' }}>
                  {/* Income bar */}
                  <div className="w-full max-w-[28px] flex flex-col items-center justify-end gap-0.5">
                    <span className="text-[10px] font-semibold text-emerald-600 leading-none">
                      {month.income > 0 ? `$${Math.round(month.income)}` : ''}
                    </span>
                    <div
                      className="w-full bg-emerald-400 rounded-t-md transition-all duration-500"
                      style={{ height: `${Math.max(incomeHeight * 0.8, month.income > 0 ? 4 : 0)}%` }}
                    />
                  </div>
                  {/* Expense bar */}
                  <div className="w-full max-w-[28px] flex flex-col items-center justify-end gap-0.5">
                    <span className="text-[10px] font-semibold text-rose-500 leading-none">
                      {month.expenses > 0 ? `$${Math.round(month.expenses)}` : ''}
                    </span>
                    <div
                      className="w-full bg-rose-400 rounded-t-md transition-all duration-500"
                      style={{ height: `${Math.max(expenseHeight * 0.8, month.expenses > 0 ? 4 : 0)}%` }}
                    />
                  </div>
                </div>
                <span
                  className={cn(
                    'text-xs font-medium',
                    isCurrent ? 'text-indigo-600' : 'text-gray-500'
                  )}
                >
                  {formatMonthLabel(month.month)}
                </span>
              </div>
            )
          })}
        </div>

        {/* Legend */}
        <div className="flex items-center justify-center gap-6 mt-4 pt-4 border-t border-gray-50">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-emerald-400" />
            <span className="text-xs text-gray-500">Income</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-rose-400" />
            <span className="text-xs text-gray-500">Expenses</span>
          </div>
        </div>
      </div>

      {/* Category Breakdown */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-5 flex items-center gap-2">
          <Tag className="w-5 h-5 text-indigo-500" />
          Spending by Category
        </h3>

        {data.category_breakdown.length === 0 ? (
          <p className="text-gray-400 text-sm py-8 text-center">
            No expenses recorded this month yet.
          </p>
        ) : (
          <div className="space-y-4">
            {data.category_breakdown.map((cat) => (
              <div key={cat.category_id || 'uncategorized'} className="group">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{cat.icon}</span>
                    <span className="text-sm font-medium text-gray-700">{cat.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900">
                      {formatCurrency(cat.total)}
                    </span>
                    <span className="text-xs text-gray-400">{cat.percentage}%</span>
                  </div>
                </div>
                <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700 animate-progress"
                    style={{
                      width: `${Math.min(cat.percentage, 100)}%`,
                      backgroundColor: cat.color,
                    }}
                  />
                </div>
                {cat.budget_limit && (
                  <p className="text-xs text-gray-400 mt-1">
                    Budget: {formatCurrency(cat.budget_limit)}
                    {cat.total > cat.budget_limit && (
                      <span className="text-rose-500 ml-1 font-medium">
                        • Over budget by {formatCurrency(cat.total - cat.budget_limit)}
                      </span>
                    )}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent Transactions */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Receipt className="w-5 h-5 text-indigo-500" />
            Transactions
          </h3>

          {/* Filter pills */}
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
            {(['all', 'income', 'expense'] as FilterType[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  'px-3 py-1 text-xs font-medium rounded-md transition-colors capitalize',
                  filter === f
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                )}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {displayTransactions.length === 0 ? (
          <div className="text-center py-12">
            <Receipt className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-400 text-sm">No transactions yet</p>
            <p className="text-gray-300 text-xs mt-1">
              Tap the + button to add your first transaction
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {displayTransactions.map((tx) => (
              <div
                key={tx.id}
                className="flex items-center justify-between p-3 rounded-xl hover:bg-gray-50 transition-colors group cursor-pointer"
                onClick={() => handleEditTransaction(tx)}
              >
                <div className="flex items-center gap-3 min-w-0">
                  {/* Category icon/color */}
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center text-base flex-shrink-0"
                    style={{ backgroundColor: tx.category?.color ? `${tx.category.color}18` : '#f3f4f6' }}
                  >
                    {tx.category?.icon || (tx.type === 'income' ? '💰' : '💸')}
                  </div>

                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {tx.description || tx.category?.name || (tx.type === 'income' ? 'Income' : 'Expense')}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-gray-400">
                        {formatDate(tx.date)}
                      </span>
                      {tx.category?.name && (
                        <span className="text-xs text-gray-400">· {tx.category.name}</span>
                      )}
                      {tx.is_recurring && (
                        <span className="inline-flex items-center gap-0.5 text-xs text-indigo-500">
                          <Repeat className="w-3 h-3" />
                          {tx.recurring_interval}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 flex-shrink-0">
                  <span
                    className={cn(
                      'text-sm font-semibold',
                      tx.type === 'income' ? 'text-emerald-600' : 'text-rose-600'
                    )}
                  >
                    {tx.type === 'income' ? '+' : '-'}
                    {formatCurrency(tx.amount)}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleTransactionDeleted(tx.id)
                    }}
                    className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-rose-500 transition-all p-1 rounded-md hover:bg-rose-50"
                    title="Delete"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {transactions.length > 10 && (
          <div className="mt-4 text-center">
            <p className="text-xs text-gray-400">
              Showing {displayTransactions.length} of {transactionsTotal} transactions
            </p>
          </div>
        )}
      </div>

      {/* FAB - Quick Add */}
      <button
        onClick={() => {
          setEditingTransaction(null)
          setShowTransactionForm(true)
        }}
        className="fixed bottom-6 right-6 w-14 h-14 bg-indigo-600 text-white rounded-2xl shadow-lg hover:bg-indigo-700 hover:shadow-xl transition-all flex items-center justify-center z-40 active:scale-95"
        title="Add Transaction"
      >
        <Plus className="w-6 h-6" />
      </button>

      {/* Transaction Form Modal */}
      {showTransactionForm && (
        <TransactionForm
          onClose={() => {
            setShowTransactionForm(false)
            setEditingTransaction(null)
          }}
          onSuccess={handleTransactionCreated}
          initialData={formInitialData}
        />
      )}

      {/* Category Manager Modal */}
      {showCategoryManager && (
        <CategoryManager
          onClose={() => setShowCategoryManager(false)}
          onUpdated={refreshData}
        />
      )}
    </div>
  )
}
