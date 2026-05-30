'use client'

import { useState, useEffect, useCallback } from 'react'
import { X, Calendar, Repeat, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Category {
  id: string
  name: string
  icon: string
  color: string
  type: string
  budget_limit: number | null
}

interface TransactionFormProps {
  onClose: () => void
  onSuccess: () => void
  initialData?: {
    id: string
    amount: number
    type: string
    category_id?: string | null
    description?: string | null
    notes?: string | null
    date: string
    is_recurring?: boolean
    recurring_interval?: string | null
    category?: { id: string; name: string; icon: string; color: string } | null
    [key: string]: unknown
  } | null
}

export default function TransactionForm({ onClose, onSuccess, initialData }: TransactionFormProps) {
  const isEditing = !!initialData

  const [amount, setAmount] = useState(
    initialData ? String(Math.abs(initialData.amount)) : ''
  )
  const [type, setType] = useState<'income' | 'expense'>(
    (initialData?.type as 'income' | 'expense') || 'expense'
  )
  const [categoryId, setCategoryId] = useState(initialData?.category_id || initialData?.category?.id || '')
  const [description, setDescription] = useState(initialData?.description || '')
  const [notes, setNotes] = useState((initialData as any)?.notes || '')
  const [date, setDate] = useState(
    initialData?.date
      ? new Date(initialData.date).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10)
  )
  const [isRecurring, setIsRecurring] = useState(initialData?.is_recurring || false)
  const [recurringInterval, setRecurringInterval] = useState(
    initialData?.recurring_interval || 'monthly'
  )

  const [categories, setCategories] = useState<Category[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')

  // Fetch categories
  useEffect(() => {
    fetchCategories()
  }, [])

  const fetchCategories = async () => {
    try {
      const res = await fetch(`/api/budget/categories?type=${type}`)
      if (res.ok) {
        const json = await res.json()
        setCategories(json.categories)
      }
    } catch (err) {
      console.error('Failed to fetch categories:', err)
    }
  }

  // Re-fetch when type changes
  useEffect(() => {
    fetchCategories()
  }, [type])

  const filteredCategories = categories.filter((c) => c.type === type)

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    // Allow only numbers and one decimal point
    if (/^\d*\.?\d{0,2}$/.test(val) || val === '') {
      setAmount(val)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    const numericAmount = parseFloat(amount)
    if (!amount || isNaN(numericAmount) || numericAmount <= 0) {
      setError('Please enter a valid amount')
      return
    }

    setIsSubmitting(true)

    try {
      const url = isEditing
        ? `/api/budget/transactions/${initialData!.id}`
        : '/api/budget/transactions'

      const method = isEditing ? 'PATCH' : 'POST'

      const body: Record<string, unknown> = {
        amount: numericAmount,
        type,
        category_id: categoryId || null,
        description: description || null,
        notes: notes || null,
        date,
        is_recurring: isRecurring,
        recurring_interval: isRecurring ? recurringInterval : null,
      }

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const json = await res.json()
        setError(json.error || 'Failed to save transaction')
        setIsSubmitting(false)
        return
      }

      onSuccess()
    } catch (err) {
      console.error('Failed to save:', err)
      setError('Network error. Please try again.')
      setIsSubmitting(false)
    }
  }

  // Handle backdrop click
  const handleBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={handleBackdrop}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-slide-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">
            {isEditing ? 'Edit Transaction' : 'Add Transaction'}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Type Toggle */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setType('expense')}
              className={cn(
                'flex-1 py-2.5 px-4 rounded-xl text-sm font-medium transition-all border-2',
                type === 'expense'
                  ? 'border-rose-300 bg-rose-50 text-rose-700'
                  : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
              )}
            >
              💸 Expense
            </button>
            <button
              type="button"
              onClick={() => setType('income')}
              className={cn(
                'flex-1 py-2.5 px-4 rounded-xl text-sm font-medium transition-all border-2',
                type === 'income'
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                  : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
              )}
            >
              💰 Income
            </button>
          </div>

          {/* Amount */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Amount
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-light text-gray-400">
                $
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={handleAmountChange}
                placeholder="0.00"
                autoFocus={!isEditing}
                className="w-full pl-10 pr-4 py-3.5 text-3xl font-bold text-gray-900 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all placeholder:text-gray-300"
              />
            </div>
          </div>

          {/* Category */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Category
            </label>
            {filteredCategories.length > 0 ? (
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-colors"
              >
                <option value="">Select a category</option>
                {filteredCategories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.icon} {cat.name}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-sm text-gray-400 py-2.5 px-4 bg-gray-50 rounded-xl">
                No {type} categories yet. Create one in Category Manager.
              </p>
            )}
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Description
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g., Groceries, Salary..."
              className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-colors placeholder:text-gray-400"
            />
          </div>

          {/* Date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Date
            </label>
            <div className="relative">
              <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-colors"
              />
            </div>
          </div>

          {/* Notes (optional, collapsible) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Notes <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any additional notes..."
              rows={2}
              className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-colors placeholder:text-gray-400 resize-none"
            />
          </div>

          {/* Recurring */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                <Repeat className="w-4 h-4 text-gray-400" />
                Recurring
              </label>
              <button
                type="button"
                onClick={() => setIsRecurring(!isRecurring)}
                className={cn(
                  'relative w-10 h-6 rounded-full transition-colors',
                  isRecurring ? 'bg-indigo-600' : 'bg-gray-300'
                )}
              >
                <span
                  className={cn(
                    'absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform',
                    isRecurring ? 'left-4.5 translate-x-0' : 'left-0.5'
                  )}
                  style={{ transform: isRecurring ? 'translateX(0.5rem)' : 'translateX(0)' }}
                />
              </button>
            </div>

            {isRecurring && (
              <select
                value={recurringInterval}
                onChange={(e) => setRecurringInterval(e.target.value)}
                className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors"
              >
                <option value="weekly">Weekly</option>
                <option value="biweekly">Biweekly</option>
                <option value="monthly">Monthly</option>
              </select>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-2.5">
              <p className="text-sm text-rose-700">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className={cn(
                'flex-1 px-4 py-2.5 text-sm font-medium text-white rounded-xl transition-all flex items-center justify-center gap-2',
                type === 'income'
                  ? 'bg-emerald-600 hover:bg-emerald-700'
                  : 'bg-indigo-600 hover:bg-indigo-700',
                isSubmitting && 'opacity-70 cursor-not-allowed'
              )}
            >
              {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {isEditing ? 'Save Changes' : 'Add Transaction'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
