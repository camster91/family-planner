'use client'

/**
 * Food inventory page (#263): items grouped by fridge / freezer / pantry,
 * "Use soon" (expired and expiring within 3 days) and "What can I cook"
 * (saved recipes ranked by in-stock coverage, with one tap to add the missing
 * ingredients to groceries through the #253 `from-recipe` flow).
 *
 * Expiry is always written out ("Expired yesterday", "Use in 2 days"); colour
 * only reinforces the words. Targets are at least 44×44.
 */
import * as React from 'react'
import Link from 'next/link'
import { AlertTriangle, BookOpen, Camera, ChefHat, ChevronRight, Clock, Plus, Refrigerator, X } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/Skeleton'
import { AddToGroceriesButton } from '@/components/meals/AddToGroceriesButton'
import { ScanFridgeDialog } from './ScanFridgeDialog'
import { useFeatureEnabled } from '@/components/providers/features-provider'
import { cn } from '@/lib/utils'
import { formatDateOnly, toDateOnlyLocal } from '@/lib/dates'
import {
  INVENTORY_LOCATIONS,
  LOCATION_LABELS,
  expiryLabel,
  type CookSuggestion,
  type ExpiryStatus,
  type InventoryItemDto,
  type InventoryLocation,
  type UseSoonItem,
} from '@/lib/inventory'

type Load<T> = { state: 'loading' } | { state: 'error' } | { state: 'ready'; data: T }

interface CookData {
  suggestions: CookSuggestion[]
  recipesConsidered: number
  truncated: boolean
  /** Some recipes or items were past the server's scan caps (older servers omit it). */
  inputsTruncated?: boolean
}

/** Items per request (the API maximum) and the most pages the page follows. */
const ITEM_PAGE_SIZE = 500
const ITEM_MAX_PAGES = 20

/** API error envelope `{ error: { message } }` or legacy `{ error: string }`. */
async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json()
    const err = body?.error
    if (typeof err === 'string') return err
    if (err && typeof err.message === 'string') return err.message
  } catch {
    // fall through
  }
  return fallback
}

function amountText(item: Pick<InventoryItemDto, 'amount' | 'unit'>): string | null {
  if (item.amount === null && !item.unit) return null
  if (item.amount === null) return item.unit
  const n = Number.isInteger(item.amount) ? String(item.amount) : String(Math.round(item.amount * 100) / 100)
  return item.unit ? `${n} ${item.unit}` : n
}

const STATUS_STYLE: Record<ExpiryStatus, string> = {
  expired: 'bg-[var(--danger-tint)] text-[var(--danger-text)]',
  today: 'bg-[var(--warning-tint)] text-[var(--warning-text)]',
  soon: 'bg-[var(--warning-tint)] text-[var(--warning-text)]',
  later: 'bg-[var(--surface-fill)] text-label-secondary',
  none: 'bg-[var(--surface-fill)] text-label-secondary',
}

/** The expiry badge: the words carry the meaning; colour only reinforces them. */
function ExpiryBadge({ status, daysLeft }: { status: ExpiryStatus; daysLeft: number | null }) {
  const Icon = status === 'expired' ? AlertTriangle : Clock
  return (
    <span
      data-testid="expiry-label"
      data-status={status}
      className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-footnote font-semibold', STATUS_STYLE[status])}
    >
      {status !== 'none' && status !== 'later' && <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />}
      {expiryLabel(status, daysLeft)}
    </span>
  )
}

export default function InventoryClient({
  canWrite,
  canOpenRecipes,
  canScan = false,
}: {
  canWrite: boolean
  canOpenRecipes: boolean
  /** Parent, and the deployment has a fridge-scan provider key (#265). */
  canScan?: boolean
}) {
  const mealsOn = useFeatureEnabled('meals')
  const [items, setItems] = React.useState<Load<InventoryItemDto[]>>({ state: 'loading' })
  const [useSoon, setUseSoon] = React.useState<Load<UseSoonItem[]>>({ state: 'loading' })
  const [cook, setCook] = React.useState<Load<CookData>>({ state: 'loading' })
  const [editing, setEditing] = React.useState<{ mode: 'add' } | { mode: 'edit'; item: InventoryItemDto } | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [itemsCapped, setItemsCapped] = React.useState(false)
  const [scanning, setScanning] = React.useState(false)

  const load = React.useCallback(async () => {
    const today = toDateOnlyLocal(new Date())
    const q = `today=${encodeURIComponent(today)}`
    setItems({ state: 'loading' })
    setUseSoon({ state: 'loading' })
    setCook({ state: 'loading' })
    const get = async <T,>(url: string, pick: (body: any) => T): Promise<Load<T>> => {
      try {
        const res = await fetch(url)
        if (!res.ok) return { state: 'error' }
        return { state: 'ready', data: pick(await res.json()) }
      } catch {
        return { state: 'error' }
      }
    }
    // Follow `nextOffset` so a large household sees every item, up to a
    // bounded number of pages; past that the page says the list is cut short.
    const getAllItems = async (): Promise<Load<InventoryItemDto[]>> => {
      const all: InventoryItemDto[] = []
      let offset: number | null = 0
      for (let page = 0; offset !== null && page < ITEM_MAX_PAGES; page++) {
        const res: Load<{ items: InventoryItemDto[]; nextOffset: number | null }> = await get(
          `/api/inventory?${q}&limit=${ITEM_PAGE_SIZE}&offset=${offset}`,
          (b) => ({ items: b.items as InventoryItemDto[], nextOffset: (b.nextOffset ?? null) as number | null })
        )
        if (res.state !== 'ready') return { state: 'error' }
        all.push(...res.data.items)
        offset = res.data.nextOffset
      }
      setItemsCapped(offset !== null)
      return { state: 'ready', data: all }
    }
    const [list, soon, cooked] = await Promise.all([
      getAllItems(),
      get(`/api/inventory/use-soon?${q}&days=3`, (b) => b.items as UseSoonItem[]),
      mealsOn
        ? get(`/api/inventory/cook?${q}`, (b) => b as CookData)
        : Promise.resolve<Load<CookData>>({
            state: 'ready',
            data: { suggestions: [], recipesConsidered: 0, truncated: false, inputsTruncated: false },
          }),
    ])
    setItems(list)
    setUseSoon(soon)
    setCook(cooked)
  }, [mealsOn])

  React.useEffect(() => {
    load()
  }, [load])

  const afterChange = async (message: string) => {
    setEditing(null)
    setScanning(false)
    setNotice(message)
    await load()
  }

  const grouped = React.useMemo(() => {
    const out: Record<InventoryLocation, InventoryItemDto[]> = { fridge: [], freezer: [], pantry: [] }
    if (items.state !== 'ready') return out
    for (const item of items.data) out[item.location].push(item)
    // Soonest expiry first, undated last, then by name.
    for (const loc of INVENTORY_LOCATIONS) {
      out[loc].sort(
        (a, b) =>
          (a.expires_on ?? '9999-12-31').localeCompare(b.expires_on ?? '9999-12-31') || a.name.localeCompare(b.name)
      )
    }
    return out
  }, [items])

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-large-title font-display">Food inventory</h1>
          <p className="text-subhead text-label-secondary mt-0.5">What&apos;s in the fridge, freezer and pantry.</p>
        </div>
        {(canWrite || canScan) && (
          <div className="flex flex-wrap gap-2">
            {canScan && (
              <button type="button" className="btn-tinted min-h-[44px]" onClick={() => setScanning(true)}>
                <Camera className="w-4 h-4" aria-hidden="true" />
                <span>Scan fridge</span>
              </button>
            )}
            {canWrite && (
              <button type="button" className="btn-tinted min-h-[44px]" onClick={() => setEditing({ mode: 'add' })}>
                <Plus className="w-4 h-4" aria-hidden="true" />
                <span>Add item</span>
              </button>
            )}
          </div>
        )}
      </div>

      <div role="status" aria-live="polite" className="empty:hidden">
        {notice && <p className="text-subhead text-label-secondary">{notice}</p>}
      </div>

      {items.state === 'error' ? (
        <EmptyState
          icon={Refrigerator}
          glyphColor="meals"
          title="Couldn't load the inventory"
          description="Check your connection and try again."
          action={
            <button type="button" className="btn-tinted min-h-[44px]" onClick={load}>
              Try again
            </button>
          }
        />
      ) : (
        <>
          <UseSoonSection load={useSoon} onRetry={load} />
          {mealsOn && <CookSection load={cook} onRetry={load} canOpenRecipes={canOpenRecipes} />}
          {items.state === 'loading' ? (
            <div className="space-y-3" role="status" aria-label="Loading inventory">
              {[0, 1].map((i) => (
                <div key={i} className="card-apple p-4 space-y-3">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ))}
            </div>
          ) : items.data.length === 0 ? (
            <EmptyState
              icon={Refrigerator}
              glyphColor="meals"
              title="Nothing tracked yet"
              description={
                canWrite
                  ? 'Add what is in your fridge, freezer and pantry. Add an expiry date to see what to use soon.'
                  : 'A parent or teen can add what is in the fridge, freezer and pantry.'
              }
              action={
                canWrite ? (
                  <button type="button" className="btn-tinted min-h-[44px]" onClick={() => setEditing({ mode: 'add' })}>
                    <Plus className="w-4 h-4" aria-hidden="true" />
                    <span>Add item</span>
                  </button>
                ) : undefined
              }
            />
          ) : (
            <>
              {itemsCapped && (
                <p className="text-footnote text-label-secondary" data-testid="items-capped">
                  Showing the first {(ITEM_PAGE_SIZE * ITEM_MAX_PAGES).toLocaleString('en-US')} items.
                </p>
              )}
              {INVENTORY_LOCATIONS.map((loc) => (
                <LocationSection
                  key={loc}
                  location={loc}
                  items={grouped[loc]}
                  canWrite={canWrite}
                  onEdit={(item) => setEditing({ mode: 'edit', item })}
                />
              ))}
            </>
          )}
        </>
      )}

      {scanning && <ScanFridgeDialog onClose={() => setScanning(false)} onDone={afterChange} />}

      {editing && (
        <ItemModal
          mode={editing.mode}
          initial={editing.mode === 'edit' ? editing.item : undefined}
          onClose={() => setEditing(null)}
          onDone={afterChange}
        />
      )}
    </div>
  )
}

function UseSoonSection({ load, onRetry }: { load: Load<UseSoonItem[]>; onRetry: () => void }) {
  return (
    <section aria-labelledby="inventory-use-soon" data-testid="use-soon">
      <h2 id="inventory-use-soon" className="section-header">
        Use soon
      </h2>
      <div className="card-apple overflow-hidden">
        {load.state === 'loading' ? (
          <div className="p-4 space-y-2" role="status" aria-label="Loading use soon">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-5 w-1/2" />
          </div>
        ) : load.state === 'error' ? (
          <div className="p-4 flex flex-wrap items-center justify-between gap-2">
            <p className="text-subhead text-[var(--danger-text)]">Couldn&apos;t load what to use soon.</p>
            <button type="button" className="btn-tinted min-h-[44px]" onClick={onRetry}>
              Try again
            </button>
          </div>
        ) : load.data.length === 0 ? (
          <p className="p-4 text-subhead text-label-secondary">Nothing expires in the next 3 days.</p>
        ) : (
          <ul className="divide-y divide-[var(--surface-separator)]">
            {load.data.map((item) => (
              <li key={item.id} data-testid="use-soon-item" className="px-4 py-3 min-h-[52px] flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="flex-1 min-w-0">
                  <span className="block text-body text-label-primary break-words">{item.name}</span>
                  <span className="block text-footnote text-label-secondary">
                    {LOCATION_LABELS[item.location]} · {formatDateOnly(item.expiresOn)}
                  </span>
                </span>
                <ExpiryBadge status={item.status} daysLeft={item.daysLeft} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

function CookSection({ load, onRetry, canOpenRecipes }: { load: Load<CookData>; onRetry: () => void; canOpenRecipes: boolean }) {
  return (
    <section aria-labelledby="inventory-cook" data-testid="what-can-i-cook">
      <h2 id="inventory-cook" className="section-header">
        What can I cook
      </h2>
      {load.state === 'loading' ? (
        <div className="card-apple p-4 space-y-2" role="status" aria-label="Loading recipe suggestions">
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      ) : load.state === 'error' ? (
        <div className="card-apple p-4 flex flex-wrap items-center justify-between gap-2">
          <p className="text-subhead text-[var(--danger-text)]">Couldn&apos;t load recipe suggestions.</p>
          <button type="button" className="btn-tinted min-h-[44px]" onClick={onRetry}>
            Try again
          </button>
        </div>
      ) : load.data.suggestions.length === 0 ? (
        <p className="card-apple p-4 text-subhead text-label-secondary" data-testid="cook-empty">
          {load.data.inputsTruncated
            ? 'No match among the recipes and items checked. You have more recipes or items than we can compare at once, so this may be incomplete.'
            : 'No saved recipe uses what you have yet. Add items, or save recipes in Meals, to see ideas here.'}
        </p>
      ) : (
        <>
        {load.data.inputsTruncated && (
          <p className="mb-3 text-footnote text-label-secondary" data-testid="cook-incomplete">
            You have more recipes or items than we can compare at once, so this list may be incomplete.
          </p>
        )}
        <ul className="space-y-3">
          {load.data.suggestions.map((s) => (
            <li key={s.recipeId} data-testid="cook-suggestion" data-recipe-id={s.recipeId} className="card-apple p-4 space-y-2">
              <div className="flex items-start gap-3">
                <span className="w-9 h-9 shrink-0 rounded-full bg-[var(--tint-meals)]/10 flex items-center justify-center">
                  <ChefHat className="w-4 h-4 text-[var(--tint-meals)]" aria-hidden="true" />
                </span>
                <div className="flex-1 min-w-0">
                  <h3 className="text-body font-semibold text-label-primary break-words">{s.title}</h3>
                  <p className="text-footnote text-label-secondary" data-testid="cook-coverage">
                    {s.missingCount === 0
                      ? `You have all ${s.totalCount} ingredient${s.totalCount === 1 ? '' : 's'}`
                      : `You have ${s.haveCount} of ${s.totalCount} ingredients`}
                    {s.useSoonCount > 0 ? ` · uses ${s.useSoonCount} item${s.useSoonCount === 1 ? '' : 's'} to use soon` : ''}
                  </p>
                </div>
              </div>
              <p className="text-subhead text-label-primary break-words">
                <span className="font-semibold">In stock: </span>
                {s.have.map((h) => h.name).join(', ')}
              </p>
              {s.missing.length > 0 && (
                <p className="text-subhead text-label-primary break-words" data-testid="cook-missing">
                  <span className="font-semibold">Missing: </span>
                  {s.missing.map((m) => m.name).join(', ')}
                </p>
              )}
              <div className="flex flex-wrap items-start gap-2">
                {canOpenRecipes && (
                  <Link
                    href={`/dashboard/meals/recipes/${encodeURIComponent(s.recipeId)}`}
                    className="inline-flex min-h-[44px] items-center gap-1.5 text-subhead text-[var(--accent-text)]"
                  >
                    <BookOpen className="w-4 h-4" aria-hidden="true" />
                    <span>
                      View recipe<span className="sr-only">: {s.title}</span>
                    </span>
                  </Link>
                )}
                {s.missing.length > 0 && (
                  <AddToGroceriesButton
                    className="flex-1 min-w-[14rem]"
                    recipeId={s.recipeId}
                    ingredientIds={s.missing.map((m) => m.ingredientId)}
                    label={`Add ${s.missing.length} missing to groceries`}
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
        </>
      )}
    </section>
  )
}

function LocationSection({
  location,
  items,
  canWrite,
  onEdit,
}: {
  location: InventoryLocation
  items: InventoryItemDto[]
  canWrite: boolean
  onEdit: (item: InventoryItemDto) => void
}) {
  const headingId = `inventory-${location}`
  return (
    <section aria-labelledby={headingId} data-testid="inventory-location" data-location={location}>
      <h2 id={headingId} className="section-header">
        {LOCATION_LABELS[location]} <span className="text-label-tertiary">({items.length})</span>
      </h2>
      <div className="card-apple overflow-hidden">
        {items.length === 0 ? (
          <p className="p-4 text-subhead text-label-secondary">Nothing in the {LOCATION_LABELS[location].toLowerCase()}.</p>
        ) : (
          <ul className="divide-y divide-[var(--surface-separator)]">
            {items.map((item) => {
              const amount = amountText(item)
              const body = (
                <>
                  <span className="flex-1 min-w-0">
                    <span className="block text-body text-label-primary break-words">{item.name}</span>
                    <span className="block text-footnote text-label-secondary break-words">
                      {[amount, item.expires_on ? `Expires ${formatDateOnly(item.expires_on)}` : null].filter(Boolean).join(' · ') ||
                        'No amount or date'}
                    </span>
                  </span>
                  <ExpiryBadge status={item.expiry.status} daysLeft={item.expiry.daysLeft} />
                </>
              )
              return (
                <li key={item.id} data-testid="inventory-item" data-item-id={item.id}>
                  {canWrite ? (
                    <button
                      type="button"
                      onClick={() => onEdit(item)}
                      aria-label={`Edit ${item.name}`}
                      className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 min-h-[52px] text-left active:bg-[var(--surface-fill-secondary)]"
                    >
                      {body}
                      <ChevronRight className="w-4 h-4 shrink-0 text-label-tertiary" aria-hidden="true" />
                    </button>
                  ) : (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 min-h-[52px]">{body}</div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}

function ItemModal({
  mode,
  initial,
  onClose,
  onDone,
}: {
  mode: 'add' | 'edit'
  initial?: InventoryItemDto
  onClose: () => void
  onDone: (message: string) => void
}) {
  const [name, setName] = React.useState(initial?.name ?? '')
  const [location, setLocation] = React.useState<InventoryLocation>(initial?.location ?? 'fridge')
  const [amount, setAmount] = React.useState(initial?.amount != null ? String(initial.amount) : '')
  const [unit, setUnit] = React.useState(initial?.unit ?? '')
  const [expiresOn, setExpiresOn] = React.useState(initial?.expires_on ?? '')
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const titleId = React.useId()

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const today = () => encodeURIComponent(toDateOnlyLocal(new Date()))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Enter a name.')
      return
    }
    const parsedAmount = amount.trim() === '' ? null : Number(amount)
    if (parsedAmount !== null && (!Number.isFinite(parsedAmount) || parsedAmount < 0)) {
      setError('Amount must be a number of 0 or more.')
      return
    }
    const body = {
      name: trimmed,
      location,
      amount: parsedAmount,
      unit: unit.trim() || null,
      expires_on: expiresOn || null,
    }
    setSaving(true)
    setError(null)
    try {
      const res =
        mode === 'edit' && initial
          ? await fetch(`/api/inventory/${encodeURIComponent(initial.id)}?today=${today()}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            })
          : await fetch(`/api/inventory?today=${today()}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            })
      if (!res.ok) {
        setError(await errorMessage(res, 'Could not save. Try again.'))
        return
      }
      onDone(mode === 'edit' ? `Saved ${trimmed}.` : `Added ${trimmed}.`)
    } catch {
      setError('Could not save. Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!initial) return
    if (!confirm(`Remove ${initial.name} from the inventory?`)) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/inventory/${encodeURIComponent(initial.id)}`, { method: 'DELETE' })
      if (!res.ok) {
        setError(await errorMessage(res, 'Could not remove. Try again.'))
        return
      }
      onDone(`Removed ${initial.name}.`)
    } catch {
      setError('Could not remove. Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="inventory-modal"
        className="relative bg-[var(--surface-elevated)] rounded-2xl shadow-xl w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto p-5 space-y-4"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 id={titleId} className="min-w-0 break-words text-title-3 font-display text-label-primary">
            {mode === 'add' ? 'Add item' : `Edit ${initial?.name ?? 'item'}`}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full active:bg-[var(--surface-fill)]"
          >
            <X className="w-5 h-5 text-label-tertiary" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4" noValidate>
          <div>
            <label htmlFor={`${titleId}-name`} className="text-subhead text-label-secondary mb-1 block">
              Name
            </label>
            <input
              id={`${titleId}-name`}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              required
              autoFocus
              className="w-full input-apple"
            />
          </div>

          <fieldset>
            <legend className="text-subhead text-label-secondary mb-1">Where</legend>
            <div className="grid grid-cols-3 gap-2">
              {INVENTORY_LOCATIONS.map((loc) => (
                <label
                  key={loc}
                  className={cn(
                    'relative min-h-[44px] flex items-center justify-center rounded-xl border px-2 text-subhead cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--accent)] has-[:focus-visible]:ring-offset-2',
                    location === loc
                      ? 'border-[var(--accent)] bg-[var(--accent-tint)] text-[var(--accent-text)] font-semibold'
                      : 'border-[var(--surface-separator)] text-label-primary'
                  )}
                >
                  <input
                    type="radio"
                    name={`${titleId}-location`}
                    value={loc}
                    checked={location === loc}
                    onChange={() => setLocation(loc)}
                    // Covers the whole tile, border included, so the hit target is >= 44px.
                    className="absolute -left-px -top-px h-[calc(100%+2px)] w-[calc(100%+2px)] cursor-pointer opacity-0"
                  />
                  {LOCATION_LABELS[loc]}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor={`${titleId}-amount`} className="text-subhead text-label-secondary mb-1 block">
                Amount <span className="text-label-tertiary">(optional)</span>
              </label>
              <input
                id={`${titleId}-amount`}
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full input-apple"
              />
            </div>
            <div>
              <label htmlFor={`${titleId}-unit`} className="text-subhead text-label-secondary mb-1 block">
                Unit <span className="text-label-tertiary">(optional)</span>
              </label>
              <input
                id={`${titleId}-unit`}
                type="text"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                maxLength={32}
                placeholder="e.g. g, L, pack"
                className="w-full input-apple"
              />
            </div>
          </div>

          <div>
            <label htmlFor={`${titleId}-expires`} className="text-subhead text-label-secondary mb-1 block">
              Use by <span className="text-label-tertiary">(optional)</span>
            </label>
            <div className="flex gap-2">
              <input
                id={`${titleId}-expires`}
                type="date"
                value={expiresOn}
                onChange={(e) => setExpiresOn(e.target.value)}
                className="flex-1 min-w-0 input-apple"
              />
              {expiresOn && (
                <button
                  type="button"
                  onClick={() => setExpiresOn('')}
                  className="min-h-[44px] px-3 rounded-lg text-subhead text-[var(--accent-text)] active:bg-[var(--surface-fill)]"
                >
                  Clear date
                </button>
              )}
            </div>
          </div>

          {error && (
            <p role="alert" className="text-subhead text-[var(--danger-text)]">
              {error}
            </p>
          )}

          <div className="flex gap-2 pt-2">
            {mode === 'edit' && (
              <button type="button" onClick={remove} className="btn-destructive flex-1 min-h-[44px]" disabled={saving}>
                Remove
              </button>
            )}
            <button type="submit" className="btn-tinted flex-1 min-h-[44px]" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
