'use client'

import { useState, useEffect, useCallback, useId, useRef } from 'react'
import { Calendar, Repeat, Loader2, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toDateOnlyLocal, toDateOnlyUTC } from '@/lib/dates'
import { Dialog } from '@/components/ui/dialog'

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
  /** Called after a save, or after a delete when `onDeleted` is not given. */
  onSuccess: () => void
  /** Called after the transaction was deleted (edit mode only). */
  onDeleted?: () => void
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
  } | null
}

const FIELD_CLASS =
  'w-full min-h-[44px] px-4 py-2.5 bg-[var(--surface-secondary)] border border-[var(--surface-separator)] rounded-xl text-body text-label-primary focus:outline-none focus:ring-2 focus:ring-[var(--accent)] transition-colors placeholder:text-label-tertiary'
const LABEL_CLASS = 'block text-subhead font-medium text-label-secondary mb-2'

export default function TransactionForm({ onClose, onSuccess, onDeleted, initialData }: TransactionFormProps) {
  const isEditing = !!initialData
  const ids = {
    amount: useId(),
    category: useId(),
    description: useId(),
    date: useId(),
    notes: useId(),
    recurring: useId(),
    interval: useId(),
  }

  const [amount, setAmount] = useState(initialData ? String(Math.abs(initialData.amount)) : '')
  const [type, setType] = useState<'income' | 'expense'>((initialData?.type as 'income' | 'expense') || 'expense')
  const [categoryId, setCategoryId] = useState(initialData?.category_id || initialData?.category?.id || '')
  const [description, setDescription] = useState(initialData?.description || '')
  const [notes, setNotes] = useState(initialData?.notes || '')
  // A stored date is UTC midnight, so edit its UTC day; a new transaction
  // defaults to the viewer's local today (the UTC day is tomorrow in the
  // evening west of UTC).
  const [date, setDate] = useState(initialData?.date ? toDateOnlyUTC(initialData.date) : toDateOnlyLocal(new Date()))
  const [isRecurring, setIsRecurring] = useState(initialData?.is_recurring || false)
  const [recurringInterval, setRecurringInterval] = useState(initialData?.recurring_interval || 'monthly')

  const [categories, setCategories] = useState<Category[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState('')

  const fetchCategories = useCallback(async () => {
    try {
      const res = await fetch(`/api/budget/categories?type=${type}`)
      if (res.ok) {
        const json = await res.json()
        setCategories(json.categories ?? [])
      }
    } catch (err) {
      console.error('Failed to fetch categories:', err)
    }
  }, [type])

  // Re-fetch when type changes
  useEffect(() => {
    fetchCategories()
  }, [fetchCategories])

  const filteredCategories = categories.filter((c) => c.type === type)

  // A category belongs to one type, so switching Expense/Income drops the
  // chosen category rather than saving an expense under an income category.
  const changeType = (next: 'income' | 'expense') => {
    if (next === type) return
    setType(next)
    setCategoryId('')
  }

  // The Dialog focuses its first control (Close) on open; a new transaction
  // starts in Amount instead.
  const amountRef = useRef<HTMLInputElement>(null)

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
      const url = isEditing ? `/api/budget/transactions/${initialData!.id}` : '/api/budget/transactions'

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
        const json = await res.json().catch(() => ({}))
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

  const handleDelete = async () => {
    if (!initialData) return
    setError('')
    setIsDeleting(true)
    try {
      const res = await fetch(`/api/budget/transactions/${initialData.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        setError(json.error || "Couldn't delete the transaction")
        setIsDeleting(false)
        setConfirmingDelete(false)
        return
      }
      ;(onDeleted ?? onSuccess)()
    } catch {
      setError('Network error. Please try again.')
      setIsDeleting(false)
      setConfirmingDelete(false)
    }
  }

  const busy = isSubmitting || isDeleting

  return (
    <Dialog
      open
      onClose={onClose}
      title={isEditing ? 'Edit Transaction' : 'Add Transaction'}
      testId="transaction-form"
      initialFocusRef={isEditing ? undefined : amountRef}
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Type Toggle */}
        <div className="flex gap-2" role="group" aria-label="Type">
          <button
            type="button"
            aria-pressed={type === 'expense'}
            onClick={() => changeType('expense')}
            className={cn(
              'flex-1 min-h-[44px] py-2.5 px-4 rounded-xl text-subhead font-medium transition-all border-2',
              type === 'expense'
                ? 'border-rose-300 bg-rose-50 text-rose-700'
                : 'border-[var(--surface-separator)] text-label-secondary'
            )}
          >
            <span aria-hidden="true">💸 </span>Expense
          </button>
          <button
            type="button"
            aria-pressed={type === 'income'}
            onClick={() => changeType('income')}
            className={cn(
              'flex-1 min-h-[44px] py-2.5 px-4 rounded-xl text-subhead font-medium transition-all border-2',
              type === 'income'
                ? 'border-[var(--success)] bg-[var(--success-tint)] text-success-text'
                : 'border-[var(--surface-separator)] text-label-secondary'
            )}
          >
            <span aria-hidden="true">💰 </span>Income
          </button>
        </div>

        {/* Amount */}
        <div>
          <label htmlFor={ids.amount} className={LABEL_CLASS}>
            Amount
          </label>
          <div className="relative">
            <span
              aria-hidden="true"
              className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-light text-label-tertiary"
            >
              $
            </span>
            <input
              id={ids.amount}
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={handleAmountChange}
              placeholder="0.00"
              ref={amountRef}
              className="w-full pl-10 pr-4 py-3.5 text-3xl font-bold text-label-primary bg-[var(--surface-secondary)] border border-[var(--surface-separator)] rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--accent)] transition-all placeholder:text-label-tertiary"
            />
          </div>
        </div>

        {/* Category */}
        <div>
          {filteredCategories.length > 0 ? (
            <>
              <label htmlFor={ids.category} className={LABEL_CLASS}>
                Category
              </label>
              <select
                id={ids.category}
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className={FIELD_CLASS}
              >
                <option value="">Select a category</option>
                {filteredCategories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.icon} {cat.name}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <>
              <p className={LABEL_CLASS}>Category</p>
              <p className="text-subhead text-label-secondary py-2.5 px-4 bg-[var(--surface-secondary)] rounded-xl">
                No {type} categories yet. Create one in Category Manager.
              </p>
            </>
          )}
        </div>

        {/* Description */}
        <div>
          <label htmlFor={ids.description} className={LABEL_CLASS}>
            Description
          </label>
          <input
            id={ids.description}
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g., Groceries, Salary..."
            className={FIELD_CLASS}
          />
        </div>

        {/* Date */}
        <div>
          <label htmlFor={ids.date} className={LABEL_CLASS}>
            Date
          </label>
          <div className="relative">
            <Calendar
              aria-hidden="true"
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-label-tertiary"
            />
            <input
              id={ids.date}
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={cn(FIELD_CLASS, 'pl-10')}
            />
          </div>
        </div>

        {/* Notes */}
        <div>
          <label htmlFor={ids.notes} className={LABEL_CLASS}>
            Notes <span className="text-label-tertiary font-normal">(optional)</span>
          </label>
          <textarea
            id={ids.notes}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any additional notes..."
            rows={2}
            className={cn(FIELD_CLASS, 'resize-none')}
          />
        </div>

        {/* Recurring */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <label htmlFor={ids.recurring} className="text-subhead font-medium text-label-secondary flex items-center gap-2">
              <Repeat className="w-4 h-4 text-label-tertiary" aria-hidden="true" />
              Recurring
            </label>
            <button
              id={ids.recurring}
              type="button"
              role="switch"
              aria-checked={isRecurring}
              onClick={() => setIsRecurring(!isRecurring)}
              className="inline-flex h-11 w-14 items-center justify-center rounded-full focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
            >
              <span
                className={cn(
                  'relative block w-10 h-6 rounded-full transition-colors',
                  isRecurring ? 'bg-[var(--accent-fill)]' : 'bg-[var(--label-tertiary)]'
                )}
              >
                <span
                  className="absolute left-0.5 top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform"
                  style={{ transform: isRecurring ? 'translateX(1rem)' : 'translateX(0)' }}
                />
              </span>
            </button>
          </div>

          {isRecurring && (
            <>
              <label htmlFor={ids.interval} className="sr-only">
                Repeats
              </label>
              <select
                id={ids.interval}
                value={recurringInterval}
                onChange={(e) => setRecurringInterval(e.target.value)}
                className={FIELD_CLASS}
              >
                <option value="weekly">Weekly</option>
                <option value="biweekly">Biweekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </>
          )}
        </div>

        {/* Error */}
        {error && (
          <div role="alert" className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-2.5">
            <p className="text-subhead text-rose-700">{error}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost min-h-[44px] flex-1">
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className={cn(
              'flex-1 min-h-[44px] px-4 py-2.5 text-subhead font-semibold text-white rounded-xl transition-all flex items-center justify-center gap-2',
              type === 'income' ? 'bg-tint-lists hover:opacity-90' : 'bg-accent-fill hover:bg-accent-fill-hover',
              busy && 'opacity-70 cursor-not-allowed'
            )}
          >
            {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
            {isEditing ? 'Save Changes' : 'Add Transaction'}
          </button>
        </div>

        {/* Delete (edit only): a second tap confirms, inside the dialog. */}
        {isEditing && (
          <div className="border-t border-[var(--surface-separator)] pt-4">
            {confirmingDelete ? (
              <div className="space-y-2" role="group" aria-label="Delete transaction">
                <p className="text-subhead text-label-primary">Delete this transaction? This can&apos;t be undone.</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(false)}
                    disabled={isDeleting}
                    className="btn-ghost min-h-[44px] flex-1"
                  >
                    Keep
                  </button>
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={busy}
                    className="btn-destructive flex-1 disabled:opacity-40"
                  >
                    {isDeleting ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                disabled={busy}
                className="min-h-[44px] w-full inline-flex items-center justify-center gap-2 rounded-xl text-subhead font-medium text-label-destructive hover:bg-[var(--surface-secondary)] disabled:opacity-40"
              >
                <Trash2 className="w-4 h-4" aria-hidden="true" />
                Delete transaction
              </button>
            )}
          </div>
        )}
      </form>
    </Dialog>
  )
}
