'use client'

import { useState, useEffect, useCallback, useId, useRef } from 'react'
import { Calendar, Repeat, Loader2, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toDateOnlyLocal, toDateOnlyUTC } from '@/lib/dates'
import { Dialog } from '@/components/ui/dialog'
import { useBudgetText } from '@/i18n/budget'
import { IDEMPOTENCY_HEADER, newIdempotencyKey } from '@/lib/idempotency-key'

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
  onSuccess: (transaction?: SavedTransaction) => void
  /** Called after the transaction was deleted (edit mode only). */
  onDeleted?: (transactionId?: string) => void
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

export interface SavedTransaction {
  id: string
  amount: number
  type: string
  description: string | null
  notes: string | null
  category_id: string | null
  date: string
  is_recurring: boolean
  recurring_interval: string | null
  category: { id: string; name: string; icon: string; color: string } | null
  user: { id: string; name: string; avatar_url: string | null }
}

const FIELD_CLASS =
  'w-full min-h-[44px] px-4 py-2.5 bg-[var(--surface-secondary)] border border-[var(--surface-separator)] rounded-xl text-body text-label-primary focus:outline-none focus:ring-2 focus:ring-[var(--accent)] transition-colors placeholder:text-label-tertiary'
const LABEL_CLASS = 'block text-subhead font-medium text-label-secondary mb-2'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isCategory(value: unknown): value is Category {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.icon === 'string' &&
    typeof value.color === 'string' &&
    typeof value.type === 'string' &&
    (value.budget_limit === null || (typeof value.budget_limit === 'number' && Number.isFinite(value.budget_limit)))
  )
}

// The budget API trims optional text before writing it and treats an empty
// result as null. Build the request from that canonical value so an accepted
// response still validates when the draft included surrounding whitespace.
function canonicalOptionalText(value: string): string | null {
  const trimmed = value.trim()
  return trimmed || null
}

function parseCategoriesResponse(value: unknown): Category[] | null {
  if (!isRecord(value) || !Array.isArray(value.categories) || !value.categories.every(isCategory)) return null
  return value.categories
}

function parseTransactionResponse(
  value: unknown,
  expectedId: string | null,
  body: Record<string, unknown>,
): SavedTransaction | null {
  if (!isRecord(value) || !isRecord(value.transaction)) return null
  const row = value.transaction
  const category = row.category
  const user = row.user
  const validCategory = category === null || (
    isRecord(category) &&
    typeof category.id === 'string' &&
    typeof category.name === 'string' &&
    typeof category.icon === 'string' &&
    typeof category.color === 'string'
  )
  const categoryMatchesId = row.category_id === null
    ? category === null
    : isRecord(category) && validCategory && category.id === row.category_id
  const validUser = isRecord(user) &&
    typeof user.id === 'string' &&
    typeof user.name === 'string' &&
    (user.avatar_url === null || typeof user.avatar_url === 'string')
  if (
    typeof row.id !== 'string' || !row.id ||
    (expectedId !== null && row.id !== expectedId) ||
    typeof row.amount !== 'number' || !Number.isFinite(row.amount) || row.amount !== body.amount ||
    typeof row.type !== 'string' || row.type !== body.type ||
    (row.description !== null && typeof row.description !== 'string') ||
    (row.notes !== null && typeof row.notes !== 'string') ||
    typeof row.date !== 'string' ||
    typeof row.is_recurring !== 'boolean' ||
    (row.recurring_interval !== null && typeof row.recurring_interval !== 'string') ||
    (row.category_id !== null && typeof row.category_id !== 'string') ||
    row.category_id !== body.category_id ||
    row.description !== body.description ||
    row.notes !== body.notes ||
    row.is_recurring !== body.is_recurring ||
    row.recurring_interval !== body.recurring_interval ||
    (typeof body.date !== 'string' || row.date.slice(0, 10) !== body.date) ||
    !validCategory || !categoryMatchesId || !validUser
  ) return null
  return {
    id: row.id,
    amount: row.amount,
    type: row.type as string,
    description: row.description,
    notes: row.notes,
    category_id: row.category_id,
    date: row.date,
    is_recurring: row.is_recurring,
    recurring_interval: row.recurring_interval,
    category: category as SavedTransaction['category'],
    user: user as SavedTransaction['user'],
  }
}

function isConfirmedDelete(value: unknown): boolean {
  return isRecord(value) && value.success === true
}

const PERMISSION_ERROR_CODES = new Set([
  'UNAUTHORIZED',
  'FORBIDDEN',
  'PARENT_REQUIRED',
  'FAMILY_REQUIRED',
  'DEVICE_WRITE_NOT_ALLOWED',
  'DEVICE_WRITES_OFF',
  'FEATURE_DISABLED',
  'PERSON_SESSION_REQUIRED',
])

const CONFLICT_ERROR_CODES = new Set([
  'CONFLICT',
  'IDENTITY_CONFLICT',
  'DUPLICATE_OPEN_ITEM',
  'ALREADY_EXISTS',
])

function isAmbiguousMutation(status: number, payload: unknown): boolean {
  const code = errorCode(payload)
  if (code === 'IDEMPOTENCY_KEY_REUSED' || code === 'IDEMPOTENCY_KEY_INVALID' || code === 'IDEMPOTENCY_KEY_REQUIRED') {
    return false
  }
  if (code === 'IDEMPOTENCY_IN_PROGRESS') return true
  return status === 408 || status === 409 || status >= 500 || (code !== null && CONFLICT_ERROR_CODES.has(code))
}

function errorCode(value: unknown): string | null {
  if (typeof value === 'string') {
    const code = value.trim().toUpperCase()
    return /^[A-Z][A-Z0-9_]*$/.test(code) ? code : null
  }
  if (!isRecord(value)) return null
  for (const candidate of [value.code, value.errorCode, value.error]) {
    const code = errorCode(candidate)
    if (code) return code
  }
  return null
}

function mutationErrorMessage(
  payload: unknown,
  status: number,
  action: 'save' | 'delete',
  text: ReturnType<typeof useBudgetText>
): string {
  const code = errorCode(payload)
  if (status === 401 || status === 403 || (code !== null && PERMISSION_ERROR_CODES.has(code))) {
    return text(action === 'save' ? 'saveFailed' : 'deleteFailed')
  }
  if (status === 409 || (code !== null && CONFLICT_ERROR_CODES.has(code))) {
    return text(action === 'save' ? 'saveFailed' : 'deleteFailed')
  }
  // Never render server-controlled messages. They can be objects, English
  // implementation details, or contain private data from another boundary.
  return text(action === 'save' ? 'saveFailed' : 'deleteFailed')
}

export default function TransactionForm({ onClose, onSuccess, onDeleted, initialData }: TransactionFormProps) {
  const isEditing = !!initialData
  const text = useBudgetText()
  const formId = useId()
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
  const [isLoadingCategories, setIsLoadingCategories] = useState(true)
  const [categoryError, setCategoryError] = useState<'server' | 'network' | null>(null)
  const categoryRequest = useRef({ token: 0, type: type as string, inFlight: false })
  const submitInFlight = useRef(false)
  const deleteInFlight = useRef(false)
  const saveIntent = useRef<{ payload: string; key: string } | null>(null)
  const deleteIntent = useRef<string | null>(null)
  const [mutationRecovery, setMutationRecovery] = useState<'save' | 'delete' | null>(null)
  const busy = isSubmitting || isDeleting

  const fetchCategories = useCallback(async () => {
    const previous = categoryRequest.current
    if (previous.inFlight && previous.type === type) return
    const token = previous.token + 1
    categoryRequest.current = { token, type, inFlight: true }
    setIsLoadingCategories(true)
    setCategoryError(null)
    try {
      const res = await fetch(`/api/budget/categories?type=${type}`)
      if (categoryRequest.current.token !== token) return
      if (!res.ok) {
        setCategoryError('server')
        return
      }
      const json = await res.json().catch(() => undefined)
      if (categoryRequest.current.token !== token) return
      const nextCategories = parseCategoriesResponse(json)
      if (!nextCategories) {
        setCategoryError('server')
        return
      }
      setCategories(nextCategories)
    } catch {
      if (categoryRequest.current.token !== token) return
      setCategoryError('network')
    } finally {
      if (categoryRequest.current.token === token) {
        categoryRequest.current.inFlight = false
        setIsLoadingCategories(false)
      }
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
    setCategoryError(null)
    setIsLoadingCategories(true)
  }

  // The Dialog focuses its first control (Close) on open; a new transaction
  // starts in Amount instead.
  const amountRef = useRef<HTMLInputElement>(null)
  const errorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const errorElement = errorRef.current
    const scrollIntoView = errorElement?.scrollIntoView
    if (error && errorElement && typeof scrollIntoView === 'function') {
      // Keep the focused field or action unchanged while revealing the new
      // message inside the form's scrolling body above the fixed footer.
      scrollIntoView.call(errorElement, { block: 'nearest' })
    }
  }, [error])

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    // Allow only numbers and one decimal point
    if (/^\d*\.?\d{0,2}$/.test(val) || val === '') {
      setAmount(val)
    }
  }

  const submitTransaction = async () => {
    if (busy || submitInFlight.current || deleteInFlight.current) return
    setError('')

    const numericAmount = parseFloat(amount)
    if (!amount || isNaN(numericAmount) || numericAmount <= 0) {
      setError(text('transactionInvalidAmount'))
      return
    }

    const body: Record<string, unknown> = {
      amount: numericAmount,
      type,
      category_id: categoryId || null,
      description: canonicalOptionalText(description),
      notes: canonicalOptionalText(notes),
      date,
      is_recurring: isRecurring,
      recurring_interval: isRecurring ? recurringInterval : null,
    }
    const payload = JSON.stringify(body)
    const intent = saveIntent.current?.payload === payload
      ? saveIntent.current
      : { payload, key: newIdempotencyKey() }
    saveIntent.current = intent
    setMutationRecovery(null)

    submitInFlight.current = true
    setIsSubmitting(true)

    try {
      const url = isEditing ? `/api/budget/transactions/${initialData!.id}` : '/api/budget/transactions'

      const method = isEditing ? 'PATCH' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', [IDEMPOTENCY_HEADER]: intent.key },
        body: payload,
      })

      if (!res.ok) {
        const json = await res.json().catch(() => undefined)
        if (isAmbiguousMutation(res.status, json)) {
          setMutationRecovery('save')
          setError(text('transactionSaveUnknown'))
        } else {
          saveIntent.current = null
          setMutationRecovery(null)
          setError(mutationErrorMessage(json, res.status, 'save', text))
        }
        submitInFlight.current = false
        setIsSubmitting(false)
        return
      }

      const json = await res.json().catch(() => undefined)
      const transaction = parseTransactionResponse(json, initialData?.id ?? null, body)
      if (!transaction) {
        setMutationRecovery('save')
        setError(text('transactionSaveUnknown'))
        submitInFlight.current = false
        setIsSubmitting(false)
        return
      }
      saveIntent.current = null
      setMutationRecovery(null)
      submitInFlight.current = false
      setIsSubmitting(false)
      onSuccess(transaction)
    } catch {
      setMutationRecovery('save')
      setError(text('saveNetworkError'))
      submitInFlight.current = false
      setIsSubmitting(false)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    void submitTransaction()
  }

  const handleDelete = async () => {
    if (!initialData || busy || submitInFlight.current || deleteInFlight.current) return
    setError('')
    const key = deleteIntent.current ?? newIdempotencyKey()
    deleteIntent.current = key
    setMutationRecovery(null)
    deleteInFlight.current = true
    setIsDeleting(true)
    try {
      const res = await fetch(`/api/budget/transactions/${initialData.id}`, {
        method: 'DELETE',
        headers: { [IDEMPOTENCY_HEADER]: key },
      })
      if (!res.ok) {
        const json = await res.json().catch(() => undefined)
        if (isAmbiguousMutation(res.status, json)) {
          setMutationRecovery('delete')
          setError(text('transactionDeleteUnknown'))
        } else {
          deleteIntent.current = null
          setMutationRecovery(null)
          setError(mutationErrorMessage(json, res.status, 'delete', text))
          setConfirmingDelete(false)
        }
        deleteInFlight.current = false
        setIsDeleting(false)
        return
      }
      const json = await res.json().catch(() => undefined)
      if (!isConfirmedDelete(json)) {
        setMutationRecovery('delete')
        setError(text('transactionDeleteUnknown'))
        deleteInFlight.current = false
        setIsDeleting(false)
        return
      }
      deleteIntent.current = null
      setMutationRecovery(null)
      deleteInFlight.current = false
      setIsDeleting(false)
      if (onDeleted) onDeleted(initialData.id)
      else onSuccess()
    } catch {
      setMutationRecovery('delete')
      setError(text('deleteNetworkError'))
      deleteInFlight.current = false
      setIsDeleting(false)
    }
  }

  return (
    <Dialog
      open
      onClose={busy ? undefined : onClose}
      title={isEditing ? text('transactionEditTitle') : text('transactionAddTitle')}
      testId="transaction-form"
      initialFocusRef={isEditing ? undefined : amountRef}
      variant="form"
      footer={(
        <div className="flex gap-3">
          <button type="button" onClick={busy ? undefined : onClose} disabled={busy} className="btn-ghost min-h-[44px] flex-1 disabled:opacity-40">
            {text('transactionCancel')}
          </button>
          <button
            type="submit"
            form={formId}
            disabled={busy}
            className={cn(
              'flex-1 min-h-[44px] px-4 py-2.5 text-subhead font-semibold text-white rounded-xl transition-all flex items-center justify-center gap-2',
              type === 'income' ? 'bg-tint-lists hover:opacity-90' : 'bg-accent-fill hover:bg-accent-fill-hover',
              busy && 'opacity-70 cursor-not-allowed'
            )}
          >
            {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
            {isSubmitting ? text('transactionSaving') : isEditing ? text('transactionSave') : text('addTransaction')}
          </button>
        </div>
      )}
    >
      <form id={formId} onSubmit={handleSubmit} className="space-y-5">
        {/* Type Toggle */}
        <div className="flex gap-2" role="group" aria-label={text('transactionType')}>
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
            <span aria-hidden="true">💸 </span>{text('transactionExpense')}
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
            <span aria-hidden="true">💰 </span>{text('transactionIncome')}
          </button>
        </div>

        {/* Amount */}
        <div>
          <label htmlFor={ids.amount} className={LABEL_CLASS}>
            {text('transactionAmount')}
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
            <label htmlFor={ids.category} className={LABEL_CLASS}>
              {text('transactionCategory')}
            </label>
          ) : (
            <p className={LABEL_CLASS}>{text('transactionCategory')}</p>
          )}
          {isLoadingCategories && (
            <p role="status" className="text-subhead text-label-secondary py-2.5 px-4 bg-[var(--surface-secondary)] rounded-xl">
              {text('loadingCategories')}
            </p>
          )}
          {categoryError && (
            <div role="alert" className="mb-2 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--tint-rewards)] bg-[var(--tint-rewards)]/10 px-4 py-3">
              <p className="text-subhead text-label-primary">
                {categoryError === 'network' ? text('categoriesNetworkError') : text('categoriesUnavailable')}
              </p>
              <button
                type="button"
                onClick={fetchCategories}
                disabled={isLoadingCategories}
                className="btn-ghost min-h-[44px] shrink-0 px-3"
              >
                {text('retryCategories')}
              </button>
            </div>
          )}
          {filteredCategories.length > 0 ? (
            <>
              <select
                id={ids.category}
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className={FIELD_CLASS}
              >
                <option value="">{text('transactionSelectCategory')}</option>
                {filteredCategories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.icon} {cat.name}
                  </option>
                ))}
              </select>
            </>
          ) : !isLoadingCategories && !categoryError ? (
            <>
              <p className="text-subhead text-label-secondary py-2.5 px-4 bg-[var(--surface-secondary)] rounded-xl">
                {text('noCategories', { type: text(type === 'income' ? 'income' : 'expense') })}
              </p>
            </>
          ) : null}
        </div>

        {/* Description */}
        <div>
          <label htmlFor={ids.description} className={LABEL_CLASS}>
            {text('transactionDescription')}
          </label>
          <input
            id={ids.description}
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={text('transactionDescriptionPlaceholder')}
            className={FIELD_CLASS}
          />
        </div>

        {/* Date */}
        <div>
          <label htmlFor={ids.date} className={LABEL_CLASS}>
            {text('transactionDate')}
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
            {text('transactionNotes')} <span className="text-label-tertiary font-normal">{text('transactionNotesOptional')}</span>
          </label>
          <textarea
            id={ids.notes}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={text('transactionNotesPlaceholder')}
            rows={2}
            className={cn(FIELD_CLASS, 'resize-none')}
          />
        </div>

        {/* Recurring */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <label htmlFor={ids.recurring} className="text-subhead font-medium text-label-secondary flex items-center gap-2">
              <Repeat className="w-4 h-4 text-label-tertiary" aria-hidden="true" />
              {text('transactionRecurring')}
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
                {text('transactionRepeats')}
              </label>
              <select
                id={ids.interval}
                value={recurringInterval}
                onChange={(e) => setRecurringInterval(e.target.value)}
                className={FIELD_CLASS}
              >
                <option value="weekly">{text('transactionWeekly')}</option>
                <option value="biweekly">{text('transactionBiweekly')}</option>
                <option value="monthly">{text('transactionMonthly')}</option>
              </select>
            </>
          )}
        </div>

        {/* Error */}
        {error && (
          <div ref={errorRef} role="alert" className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-2.5">
            <p className="text-subhead text-rose-700">{error}</p>
            {mutationRecovery && (
              <button
                type="button"
                onClick={() => mutationRecovery === 'save' ? void submitTransaction() : void handleDelete()}
                disabled={busy}
                className="btn-ghost mt-2 min-h-[44px] px-3"
              >
                {text('transactionRetry')}
              </button>
            )}
          </div>
        )}

        {/* Delete (edit only): a second tap confirms, inside the dialog. */}
        {isEditing && (
          <div className="border-t border-[var(--surface-separator)] pt-4">
            {confirmingDelete ? (
              <div className="space-y-2" role="group" aria-label={text('transactionDelete')}>
                <p className="text-subhead text-label-primary">{text('transactionDeleteConfirm')}</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(false)}
                    disabled={isDeleting}
                    className="btn-ghost min-h-[44px] flex-1"
                  >
                    {text('transactionKeep')}
                  </button>
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={busy}
                    className="btn-destructive flex-1 disabled:opacity-40"
                  >
                    {isDeleting ? text('transactionDeleting') : text('transactionDeleteAction')}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                disabled={busy}
                className="min-h-[44px] w-full inline-flex items-center justify-center gap-2 rounded-xl text-subhead font-medium text-danger-text hover:bg-[var(--surface-secondary)] disabled:opacity-40"
              >
                <Trash2 className="w-4 h-4" aria-hidden="true" />
                {text('transactionDelete')}
              </button>
            )}
          </div>
        )}
      </form>
    </Dialog>
  )
}
