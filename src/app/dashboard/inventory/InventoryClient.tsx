'use client'

/**
 * Food inventory page (#263, #158/#121): items grouped by fridge / freezer /
 * pantry, "Past use-by" (don't eat), "Use soon" (a passed best-before day and
 * anything due within 3 days), "What can I cook" (saved recipes ranked by
 * in-stock coverage, with one tap to add the missing ingredients to groceries
 * through the #253 `from-recipe` flow), search and filters, and a short
 * history of what was used or thrown away.
 *
 * - "Used it" (all or part) and "Throw away" run at once and offer Undo in a
 *   toast (docs/product/NAVIGATION.md "Undo over confirm"); the history list
 *   keeps Undo available after the toast is gone. "Remove" (added by
 *   mistake) keeps its confirm, because it deletes the item and its history.
 * - Every write sends an `Idempotency-Key`, one per logical change, reused for
 *   a retry of the same change.
 * - Offline: nothing is queued. The app-wide banner says it is offline; the
 *   page adds when its list was loaded and that changes need a connection,
 *   and a write says it needs a connection. A failed refresh keeps
 *   the last data and says when it was loaded.
 * - Dates are always written out, and best-before and use-by never share
 *   words ("Best before was yesterday" vs "Past use-by — don't eat"); colour
 *   only reinforces them. Targets are at least 44×44.
 */
import * as React from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  BookOpen,
  Camera,
  ChefHat,
  ChevronRight,
  Clock,
  History,
  Plus,
  Refrigerator,
  Search,
  Trash2,
  Undo2,
  Utensils,
  WifiOff,
  X,
  type LucideIcon,
} from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/Skeleton'
import { useUndoToast } from '@/components/ui/toast'
import { useOnline } from '@/components/ui/use-online'
import { useDisplayLocale } from '@/components/ui/use-display-locale'
import { AddToGroceriesButton } from '@/components/meals/AddToGroceriesButton'
import { ScanFridgeDialog } from './ScanFridgeDialog'
import { useFeatureEnabled } from '@/components/providers/features-provider'
import { cn } from '@/lib/utils'
import { formatDateOnly, toDateOnlyLocal } from '@/lib/dates'
import { IDEMPOTENCY_HEADER, newIdempotencyKey } from '@/lib/idempotency-key'
import {
  CATEGORY_LABELS,
  DATE_KINDS,
  DATE_KIND_LABELS,
  INVENTORY_CATEGORIES,
  INVENTORY_LOCATIONS,
  LOCATION_LABELS,
  asCategory,
  asDateKind,
  expiryLabel,
  type CookSuggestion,
  type DateKind,
  type ExpiryStatus,
  type InventoryCategory,
  type InventoryItemDto,
  type InventoryLocation,
  type UseSoonItem,
} from '@/lib/inventory'
import type { AdjustmentDto } from '@/lib/inventory-adjust'

type Load<T> = { state: 'loading' } | { state: 'error' } | { state: 'ready'; data: T }

interface CookData {
  suggestions: CookSuggestion[]
  recipesConsidered: number
  truncated: boolean
  /** Some recipes or items were past the server's scan caps (older servers omit it). */
  inputsTruncated?: boolean
}

interface HistoryEntry extends AdjustmentDto {
  item_name: string
  item_status: string
  /** Undo would work now (latest change to the item, unchanged since). Older servers omit it. */
  undoable?: boolean
}

interface PageData {
  items: InventoryItemDto[]
  useSoon: UseSoonItem[]
  cook: Load<CookData>
  history: HistoryEntry[]
  capped: boolean
}

/** Items per request (the API maximum) and the most pages the page follows. */
const ITEM_PAGE_SIZE = 500
const ITEM_MAX_PAGES = 20
/** History rows shown under "Recently used or thrown away". */
const HISTORY_ROWS = 10

export const OFFLINE_WRITE_MESSAGE = "You're offline. Connect to the internet to change the inventory."

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

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

function todayQuery(): string {
  return `today=${encodeURIComponent(toDateOnlyLocal(new Date()))}`
}

// Dates and times on this page are display only, in the viewer's locale
// (useDisplayLocale): "Use by Oct 5" / "Use by 5 Oct", "10:42 AM" / "10:42".
// Stored day keys and form values stay YYYY-MM-DD.
function formatClock(date: Date, locale: string): string {
  return date.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
}

function formatAmount(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100)
}

function amountText(item: Pick<InventoryItemDto, 'amount' | 'unit'>): string | null {
  if (item.amount === null && !item.unit) return null
  if (item.amount === null) return item.unit
  const n = formatAmount(item.amount)
  return item.unit ? `${n} ${item.unit}` : n
}

/**
 * One idempotency key per logical change: the same body retried keeps its
 * key, a changed body gets a new one (so an edit after a failure is a new
 * change, not a 422).
 */
function useChangeKey() {
  const ref = React.useRef<{ body: string; key: string } | null>(null)
  return React.useCallback((body: unknown) => {
    const text = JSON.stringify(body ?? null)
    if (!ref.current || ref.current.body !== text) ref.current = { body: text, key: newIdempotencyKey() }
    return ref.current.key
  }, [])
}

async function postJson(url: string, body: unknown, key: string, method = 'POST'): Promise<Response> {
  return fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', [IDEMPOTENCY_HEADER]: key },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const STATUS_STYLE: Record<ExpiryStatus, string> = {
  past_use_by: 'bg-[var(--danger-tint)] text-[var(--danger-text)]',
  expired: 'bg-[var(--warning-tint)] text-[var(--warning-text)]',
  today: 'bg-[var(--warning-tint)] text-[var(--warning-text)]',
  soon: 'bg-[var(--warning-tint)] text-[var(--warning-text)]',
  later: 'bg-[var(--surface-fill)] text-label-secondary',
  none: 'bg-[var(--surface-fill)] text-label-secondary',
}

/** The date badge: the words carry the meaning; colour only reinforces them. */
function ExpiryBadge({ status, daysLeft, dateKind }: { status: ExpiryStatus; daysLeft: number | null; dateKind: DateKind }) {
  const Icon = status === 'past_use_by' || status === 'expired' ? AlertTriangle : Clock
  return (
    <span
      data-testid="expiry-label"
      data-status={status}
      className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-footnote font-semibold', STATUS_STYLE[status])}
    >
      {status !== 'none' && status !== 'later' && <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />}
      {expiryLabel(status, daysLeft, dateKind)}
    </span>
  )
}

type AdjustKind = 'consume' | 'discard'
interface AdjustTarget {
  id: string
  name: string
  unit?: string | null
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
  const online = useOnline()
  const displayLocale = useDisplayLocale()
  const showUndo = useUndoToast()
  const [data, setData] = React.useState<Load<PageData>>({ state: 'loading' })
  const [loadedAt, setLoadedAt] = React.useState<Date | null>(null)
  const [refreshFailed, setRefreshFailed] = React.useState(false)
  const [editing, setEditing] = React.useState<{ mode: 'add' } | { mode: 'edit'; item: InventoryItemDto } | null>(null)
  const [notice, setNotice] = React.useState<{ text: string; error?: boolean } | null>(null)
  const [scanning, setScanning] = React.useState(false)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [query, setQuery] = React.useState('')
  const [whereFilter, setWhereFilter] = React.useState<InventoryLocation | 'all'>('all')
  const [categoryFilter, setCategoryFilter] = React.useState<InventoryCategory | 'all'>('all')
  const hasData = React.useRef(false)

  const load = React.useCallback(async () => {
    const q = todayQuery()
    if (!hasData.current) setData({ state: 'loading' })
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
    const getAllItems = async (): Promise<Load<{ items: InventoryItemDto[]; capped: boolean }>> => {
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
      return { state: 'ready', data: { items: all, capped: offset !== null } }
    }
    const [list, soon, cooked, history] = await Promise.all([
      getAllItems(),
      get(`/api/inventory/use-soon?${q}&days=3`, (b) => b.items as UseSoonItem[]),
      mealsOn
        ? get(`/api/inventory/cook?${q}`, (b) => b as CookData)
        : Promise.resolve<Load<CookData>>({
            state: 'ready',
            data: { suggestions: [], recipesConsidered: 0, truncated: false, inputsTruncated: false },
          }),
      get(`/api/inventory/adjustments?limit=${HISTORY_ROWS}`, (b) => (b.adjustments ?? []) as HistoryEntry[]),
    ])
    if (list.state !== 'ready' || soon.state !== 'ready') {
      // Keep what was loaded; say it could not be refreshed.
      if (hasData.current) setRefreshFailed(true)
      else setData({ state: 'error' })
      return
    }
    hasData.current = true
    setRefreshFailed(false)
    setLoadedAt(new Date())
    setData({
      state: 'ready',
      data: {
        items: list.data.items,
        capped: list.data.capped,
        useSoon: soon.data,
        cook: cooked,
        history: history.state === 'ready' ? history.data : [],
      },
    })
  }, [mealsOn])

  React.useEffect(() => {
    load()
  }, [load])

  // Refresh when the connection comes back.
  const wasOnline = React.useRef(true)
  React.useEffect(() => {
    if (online && !wasOnline.current) load()
    wasOnline.current = online
  }, [online, load])

  const afterChange = async (message: string) => {
    setEditing(null)
    setScanning(false)
    setNotice({ text: message })
    await load()
  }

  const undo = React.useCallback(
    async (adjustmentId: string, name: string) => {
      if (isOffline()) {
        setNotice({ text: OFFLINE_WRITE_MESSAGE, error: true })
        return
      }
      try {
        const res = await postJson(
          `/api/inventory/adjustments/${encodeURIComponent(adjustmentId)}/undo?${todayQuery()}`,
          undefined,
          newIdempotencyKey()
        )
        if (!res.ok) {
          setNotice({ text: await errorMessage(res, `Could not put ${name} back. Try again.`), error: true })
        } else {
          setNotice({ text: `Put ${name} back.` })
        }
      } catch {
        setNotice({ text: `Could not put ${name} back. Check your connection and try again.`, error: true })
      }
      // Refresh the list and the history either way, so every Undo shown
      // still works (a refused undo usually means the item changed).
      await load()
    },
    [load]
  )

  /** "Used it" / "Throw away". Returns an error message, or null on success. */
  const adjust = React.useCallback(
    async (target: AdjustTarget, kind: AdjustKind, amount: number | null = null, key?: string): Promise<string | null> => {
      if (isOffline()) return OFFLINE_WRITE_MESSAGE
      const body = kind === 'consume' && amount !== null ? { amount } : {}
      setBusy(target.id)
      try {
        const res = await postJson(
          `/api/inventory/${encodeURIComponent(target.id)}/${kind}?${todayQuery()}`,
          body,
          key ?? newIdempotencyKey()
        )
        if (!res.ok) return await errorMessage(res, 'Could not save. Try again.')
        const result = (await res.json()) as { item: InventoryItemDto; adjustment: AdjustmentDto }
        const partial = kind === 'consume' && result.adjustment.status_after === 'active'
        const title =
          kind === 'discard'
            ? `Threw away ${target.name}`
            : partial && amount !== null
              ? `Used ${formatAmount(amount)}${target.unit ? ` ${target.unit}` : ''} of ${target.name}`
              : `Used ${target.name}`
        setEditing(null)
        setNotice({ text: `${title}.` })
        showUndo({ title, onUndo: () => void undo(result.adjustment.id, target.name) })
        await load()
        return null
      } catch {
        return 'Could not save. Check your connection and try again.'
      } finally {
        setBusy(null)
      }
    },
    [load, showUndo, undo]
  )

  const quickAdjust = async (target: AdjustTarget, kind: AdjustKind) => {
    const err = await adjust(target, kind)
    if (err) setNotice({ text: err, error: true })
  }

  const ready = data.state === 'ready' ? data.data : null
  const pastUseBy = React.useMemo(
    () =>
      (ready?.items ?? [])
        .filter((i) => i.expiry.status === 'past_use_by')
        .sort((a, b) => (a.expires_on ?? '').localeCompare(b.expires_on ?? '') || a.name.localeCompare(b.name)),
    [ready]
  )

  const filtersOn = query.trim() !== '' || whereFilter !== 'all' || categoryFilter !== 'all'
  const filtered = React.useMemo(() => {
    const items = ready?.items ?? []
    const needle = query.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase()
    return items.filter(
      (i) =>
        (!needle || i.name.toLowerCase().includes(needle)) &&
        (whereFilter === 'all' || i.location === whereFilter) &&
        (categoryFilter === 'all' || i.category === categoryFilter)
    )
  }, [ready, query, whereFilter, categoryFilter])

  const grouped = React.useMemo(() => {
    const out: Record<InventoryLocation, InventoryItemDto[]> = { fridge: [], freezer: [], pantry: [] }
    for (const item of filtered) out[item.location].push(item)
    // Soonest date first, undated last, then by name.
    for (const loc of INVENTORY_LOCATIONS) {
      out[loc].sort(
        (a, b) =>
          (a.expires_on ?? '9999-12-31').localeCompare(b.expires_on ?? '9999-12-31') || a.name.localeCompare(b.name)
      )
    }
    return out
  }, [filtered])

  const clearFilters = () => {
    setQuery('')
    setWhereFilter('all')
    setCategoryFilter('all')
  }

  const openAdd = () => {
    if (isOffline()) {
      setNotice({ text: OFFLINE_WRITE_MESSAGE, error: true })
      return
    }
    setEditing({ mode: 'add' })
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-large-title font-display">Food inventory</h1>
          <p className="text-subhead text-label-secondary mt-0.5">
            What&apos;s in the fridge, freezer and pantry, as far as the family has noted it.
          </p>
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
              <button type="button" className="btn-tinted min-h-[44px]" onClick={openAdd}>
                <Plus className="w-4 h-4" aria-hidden="true" />
                <span>Add item</span>
              </button>
            )}
          </div>
        )}
      </div>

      <div role="status" aria-live="polite" className="empty:hidden" data-testid="inventory-notice">
        {notice && (
          <p className={cn('text-subhead', notice.error ? 'text-[var(--danger-text)]' : 'text-label-secondary')}>
            {notice.text}
          </p>
        )}
      </div>

      {ready && (!online || refreshFailed) && loadedAt && (
        <div
          role="status"
          data-testid="inventory-connection"
          className="flex flex-wrap items-start gap-3 rounded-[var(--radius-lg)] border border-[var(--surface-separator)] bg-[var(--surface-elevated)] px-4 py-3 text-subhead text-label-primary"
        >
          {/* Offline, the app-wide banner says so; this notice is about the saved list. */}
          {online ? (
            <WifiOff className="mt-0.5 h-5 w-5 shrink-0 text-label-secondary" aria-hidden="true" />
          ) : (
            <History className="mt-0.5 h-5 w-5 shrink-0 text-label-secondary" aria-hidden="true" />
          )}
          <span className="flex-1 min-w-[12rem]">
            {!online
              ? `Showing what was loaded at ${formatClock(loadedAt, displayLocale)}. Changes need a connection; the list refreshes when you're back online.`
              : `Couldn't refresh. Showing what was loaded at ${formatClock(loadedAt, displayLocale)}, which may be out of date.`}
          </span>
          {online && (
            <button type="button" className="btn-tinted min-h-[44px]" onClick={load}>
              Try again
            </button>
          )}
        </div>
      )}

      {data.state === 'error' ? (
        <EmptyState
          icon={online ? Refrigerator : WifiOff}
          glyphColor="meals"
          title="Couldn't load the inventory"
          description={online ? 'Check your connection and try again.' : "The inventory loads when you're back online."}
          action={
            <button type="button" className="btn-tinted min-h-[44px]" onClick={load}>
              Try again
            </button>
          }
        />
      ) : data.state === 'loading' ? (
        <div className="space-y-3" role="status" aria-label="Loading inventory">
          {[0, 1].map((i) => (
            <div key={i} className="card-apple p-4 space-y-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ))}
        </div>
      ) : (
        <>
          {pastUseBy.length > 0 && (
            <PastUseBySection items={pastUseBy} canWrite={canWrite} busy={busy} onDiscard={(t) => quickAdjust(t, 'discard')} />
          )}
          <UseSoonSection
            items={data.data.useSoon}
            canWrite={canWrite}
            busy={busy}
            onAdjust={(t, kind) => quickAdjust(t, kind)}
          />
          {mealsOn && <CookSection load={data.data.cook} onRetry={load} canOpenRecipes={canOpenRecipes} />}
          {data.data.items.length === 0 ? (
            <EmptyState
              icon={Refrigerator}
              glyphColor="meals"
              title="Nothing tracked yet"
              description={
                canWrite
                  ? 'Add what is in your fridge, freezer and pantry. Add a best-before or use-by date to see what to use soon.'
                  : 'A parent or teen can add what is in the fridge, freezer and pantry.'
              }
              action={
                canWrite ? (
                  <button type="button" className="btn-tinted min-h-[44px]" onClick={openAdd}>
                    <Plus className="w-4 h-4" aria-hidden="true" />
                    <span>Add item</span>
                  </button>
                ) : undefined
              }
            />
          ) : (
            <>
              <FilterBar
                query={query}
                onQuery={setQuery}
                where={whereFilter}
                onWhere={setWhereFilter}
                category={categoryFilter}
                onCategory={setCategoryFilter}
                shown={filtered.length}
                total={data.data.items.length}
                filtersOn={filtersOn}
                onClear={clearFilters}
              />
              {data.data.capped && (
                <p className="text-footnote text-label-secondary" data-testid="items-capped">
                  Showing the first {(ITEM_PAGE_SIZE * ITEM_MAX_PAGES).toLocaleString('en-US')} items.
                </p>
              )}
              {filtersOn && filtered.length === 0 ? (
                <div className="card-apple p-4 flex flex-wrap items-center justify-between gap-2" data-testid="no-matches">
                  <p className="text-subhead text-label-secondary">No items match your search.</p>
                  <button type="button" className="btn-tinted min-h-[44px]" onClick={clearFilters}>
                    Clear search
                  </button>
                </div>
              ) : (
                INVENTORY_LOCATIONS.filter((loc) => whereFilter === 'all' || whereFilter === loc).map((loc) => (
                  <LocationSection
                    key={loc}
                    location={loc}
                    items={grouped[loc]}
                    canWrite={canWrite}
                    filtered={filtersOn}
                    onEdit={(item) => setEditing({ mode: 'edit', item })}
                  />
                ))
              )}
            </>
          )}
          {data.data.history.length > 0 && (
            <HistorySection entries={data.data.history} canWrite={canWrite} onUndo={(e) => undo(e.id, e.item_name)} />
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
          onAdjust={adjust}
        />
      )}
    </div>
  )
}

function ActionButton({
  onClick,
  disabled,
  icon: Icon,
  children,
  label,
}: {
  onClick: () => void
  disabled?: boolean
  icon: LucideIcon
  children: React.ReactNode
  /** Accessible name when the visible text needs the item's name. */
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="btn-ghost min-h-[44px] min-w-[44px] px-3 text-subhead disabled:opacity-50"
    >
      <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </button>
  )
}

function PastUseBySection({
  items,
  canWrite,
  busy,
  onDiscard,
}: {
  items: InventoryItemDto[]
  canWrite: boolean
  busy: string | null
  onDiscard: (target: AdjustTarget) => void
}) {
  const locale = useDisplayLocale()
  return (
    <section aria-labelledby="inventory-past-use-by" data-testid="past-use-by">
      <h2 id="inventory-past-use-by" className="section-header">
        Past use-by
      </h2>
      <div className="card-apple overflow-hidden">
        <p className="px-4 pt-3 text-footnote text-label-secondary">
          A use-by date is about safety, so these should not be eaten.
        </p>
        <ul className="divide-y divide-[var(--surface-separator)]">
          {items.map((item) => (
            <li
              key={item.id}
              data-testid="past-use-by-item"
              className="px-4 py-3 min-h-[52px] flex flex-wrap items-center gap-x-3 gap-y-2"
            >
              <span className="flex-1 min-w-[10rem]">
                <span className="block text-body text-label-primary break-words">{item.name}</span>
                <span className="block text-footnote text-label-secondary">
                  {LOCATION_LABELS[item.location]} · Use by {item.expires_on ? formatDateOnly(item.expires_on, undefined, locale) : ''}
                </span>
              </span>
              <ExpiryBadge status={item.expiry.status} daysLeft={item.expiry.daysLeft} dateKind={item.date_kind} />
              {canWrite && (
                <ActionButton
                  icon={Trash2}
                  disabled={busy === item.id}
                  label={`Throw away ${item.name}`}
                  onClick={() => onDiscard({ id: item.id, name: item.name })}
                >
                  Throw away
                </ActionButton>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function UseSoonSection({
  items,
  canWrite,
  busy,
  onAdjust,
}: {
  items: UseSoonItem[]
  canWrite: boolean
  busy: string | null
  onAdjust: (target: AdjustTarget, kind: AdjustKind) => void
}) {
  const locale = useDisplayLocale()
  return (
    <section aria-labelledby="inventory-use-soon" data-testid="use-soon">
      <h2 id="inventory-use-soon" className="section-header">
        Use soon
      </h2>
      <div className="card-apple overflow-hidden">
        {items.length === 0 ? (
          <p className="p-4 text-subhead text-label-secondary">Nothing to use in the next 3 days.</p>
        ) : (
          <ul className="divide-y divide-[var(--surface-separator)]">
            {items.map((item) => (
              <li
                key={item.id}
                data-testid="use-soon-item"
                className="px-4 py-3 min-h-[52px] flex flex-wrap items-center gap-x-3 gap-y-2"
              >
                <span className="flex-1 min-w-[10rem]">
                  <span className="block text-body text-label-primary break-words">{item.name}</span>
                  <span className="block text-footnote text-label-secondary">
                    {LOCATION_LABELS[item.location]} · {DATE_KIND_LABELS[asDateKind(item.dateKind)]}{' '}
                    {formatDateOnly(item.expiresOn, undefined, locale)}
                  </span>
                </span>
                <ExpiryBadge status={item.status} daysLeft={item.daysLeft} dateKind={asDateKind(item.dateKind)} />
                {canWrite && (
                  <span className="flex flex-wrap gap-2">
                    <ActionButton
                      icon={Utensils}
                      disabled={busy === item.id}
                      label={`Used ${item.name}`}
                      onClick={() => onAdjust({ id: item.id, name: item.name }, 'consume')}
                    >
                      Used it
                    </ActionButton>
                    <ActionButton
                      icon={Trash2}
                      disabled={busy === item.id}
                      label={`Throw away ${item.name}`}
                      onClick={() => onAdjust({ id: item.id, name: item.name }, 'discard')}
                    >
                      Throw away
                    </ActionButton>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

function FilterBar({
  query,
  onQuery,
  where,
  onWhere,
  category,
  onCategory,
  shown,
  total,
  filtersOn,
  onClear,
}: {
  query: string
  onQuery: (v: string) => void
  where: InventoryLocation | 'all'
  onWhere: (v: InventoryLocation | 'all') => void
  category: InventoryCategory | 'all'
  onCategory: (v: InventoryCategory | 'all') => void
  shown: number
  total: number
  filtersOn: boolean
  onClear: () => void
}) {
  const id = React.useId()
  return (
    <div role="search" aria-label="Search the inventory" className="card-apple p-3 space-y-3" data-testid="inventory-filters">
      <div className="relative">
        <label htmlFor={`${id}-q`} className="sr-only">
          Search by name
        </label>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-label-tertiary" aria-hidden="true" />
        <input
          id={`${id}-q`}
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          maxLength={100}
          placeholder="Search by name"
          className="w-full input-apple min-h-[44px] pl-9"
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-where`} className="text-footnote text-label-secondary mb-1 block">
            Where
          </label>
          <select
            id={`${id}-where`}
            value={where}
            onChange={(e) => onWhere(e.target.value as InventoryLocation | 'all')}
            className="w-full input-apple min-h-[44px]"
          >
            <option value="all">Everywhere</option>
            {INVENTORY_LOCATIONS.map((loc) => (
              <option key={loc} value={loc}>
                {LOCATION_LABELS[loc]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-category`} className="text-footnote text-label-secondary mb-1 block">
            Category
          </label>
          <select
            id={`${id}-category`}
            value={category}
            onChange={(e) => onCategory(e.target.value as InventoryCategory | 'all')}
            className="w-full input-apple min-h-[44px]"
          >
            <option value="all">All categories</option>
            {INVENTORY_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
      </div>
      {filtersOn && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-footnote text-label-secondary" data-testid="filter-count">
            Showing {shown} of {total} items
          </p>
          <button type="button" className="btn-plain min-h-[44px]" onClick={onClear}>
            Clear search
          </button>
        </div>
      )}
    </div>
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

function itemMeta(item: InventoryItemDto, locale: string): string {
  const parts: string[] = []
  const amount = amountText(item)
  if (amount) parts.push(amount)
  if (item.expires_on) parts.push(`${DATE_KIND_LABELS[asDateKind(item.date_kind)]} ${formatDateOnly(item.expires_on, undefined, locale)}`)
  const category = asCategory(item.category)
  if (category) parts.push(CATEGORY_LABELS[category])
  if (item.opened_on) parts.push(`Opened ${formatDateOnly(item.opened_on, undefined, locale)}`)
  return parts.join(' · ') || 'No amount or date'
}

function LocationSection({
  location,
  items,
  canWrite,
  filtered,
  onEdit,
}: {
  location: InventoryLocation
  items: InventoryItemDto[]
  canWrite: boolean
  filtered: boolean
  onEdit: (item: InventoryItemDto) => void
}) {
  const headingId = `inventory-${location}`
  const locale = useDisplayLocale()
  return (
    <section aria-labelledby={headingId} data-testid="inventory-location" data-location={location}>
      <h2 id={headingId} className="section-header">
        {LOCATION_LABELS[location]} <span className="text-label-tertiary">({items.length})</span>
      </h2>
      <div className="card-apple overflow-hidden">
        {items.length === 0 ? (
          <p className="p-4 text-subhead text-label-secondary">
            {filtered ? `No matches in the ${LOCATION_LABELS[location].toLowerCase()}.` : `Nothing in the ${LOCATION_LABELS[location].toLowerCase()}.`}
          </p>
        ) : (
          <ul className="divide-y divide-[var(--surface-separator)]">
            {items.map((item) => {
              const body = (
                <>
                  {/* A minimum width lets the badge wrap under a long name on a phone instead of squeezing it. */}
                  <span className="flex-1 min-w-[9rem]">
                    <span className="block text-body text-label-primary break-words">{item.name}</span>
                    <span className="block text-footnote text-label-secondary break-words">{itemMeta(item, locale)}</span>
                  </span>
                  <ExpiryBadge status={item.expiry.status} daysLeft={item.expiry.daysLeft} dateKind={asDateKind(item.date_kind)} />
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

function historyText(e: HistoryEntry): string {
  if (e.kind === 'discard') return `Threw away ${e.item_name}`
  if (e.status_after === 'active' && e.amount_delta !== null) {
    return `Used ${formatAmount(-e.amount_delta)} of ${e.item_name}`
  }
  return `Used ${e.item_name}`
}

function HistorySection({
  entries,
  canWrite,
  onUndo,
}: {
  entries: HistoryEntry[]
  canWrite: boolean
  onUndo: (entry: HistoryEntry) => void
}) {
  const locale = useDisplayLocale()
  return (
    <section aria-labelledby="inventory-history" data-testid="inventory-history">
      <h2 id="inventory-history" className="section-header">
        Recently used or thrown away
      </h2>
      <div className="card-apple overflow-hidden">
        <ul className="divide-y divide-[var(--surface-separator)]">
          {entries.map((e) => (
            <li key={e.id} data-testid="history-item" className="px-4 py-3 min-h-[52px] flex flex-wrap items-center gap-x-3 gap-y-2">
              <History className="w-4 h-4 shrink-0 text-label-tertiary" aria-hidden="true" />
              <span className="flex-1 min-w-[10rem]">
                <span className="block text-body text-label-primary break-words">{historyText(e)}</span>
                <span className="block text-footnote text-label-secondary">
                  {new Date(e.created_at).toLocaleString(locale, {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                  {e.undone_at ? ' · Undone' : ''}
                </span>
              </span>
              {canWrite && e.undoable === true && (
                <ActionButton icon={Undo2} label={`Undo: ${historyText(e)}`} onClick={() => onUndo(e)}>
                  Undo
                </ActionButton>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function ItemModal({
  mode,
  initial,
  onClose,
  onDone,
  onAdjust,
}: {
  mode: 'add' | 'edit'
  initial?: InventoryItemDto
  onClose: () => void
  onDone: (message: string) => void
  onAdjust: (target: AdjustTarget, kind: AdjustKind, amount: number | null, key: string) => Promise<string | null>
}) {
  const [name, setName] = React.useState(initial?.name ?? '')
  const [location, setLocation] = React.useState<InventoryLocation>(initial?.location ?? 'fridge')
  const [amount, setAmount] = React.useState(initial?.amount != null ? String(initial.amount) : '')
  const [unit, setUnit] = React.useState(initial?.unit ?? '')
  const [expiresOn, setExpiresOn] = React.useState(initial?.expires_on ?? '')
  const [dateKind, setDateKind] = React.useState<DateKind>(asDateKind(initial?.date_kind))
  const [category, setCategory] = React.useState<InventoryCategory | ''>(asCategory(initial?.category) ?? '')
  const [purchasedOn, setPurchasedOn] = React.useState(initial?.purchased_on ?? '')
  const [openedOn, setOpenedOn] = React.useState(initial?.opened_on ?? '')
  const [used, setUsed] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const titleId = React.useId()
  const saveKey = useChangeKey()
  const adjustKey = useChangeKey()
  const deleteKey = useChangeKey()

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

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
    if (isOffline()) {
      setError(OFFLINE_WRITE_MESSAGE)
      return
    }
    const body = {
      name: trimmed,
      location,
      amount: parsedAmount,
      unit: unit.trim() || null,
      expires_on: expiresOn || null,
      date_kind: dateKind,
      category: category || null,
      purchased_on: purchasedOn || null,
      opened_on: openedOn || null,
    }
    setSaving(true)
    setError(null)
    try {
      const url =
        mode === 'edit' && initial
          ? `/api/inventory/${encodeURIComponent(initial.id)}?${todayQuery()}`
          : `/api/inventory?${todayQuery()}`
      const res = await postJson(url, body, saveKey(body), mode === 'edit' ? 'PATCH' : 'POST')
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

  const adjust = async (kind: AdjustKind) => {
    if (!initial) return
    let usedAmount: number | null = null
    if (kind === 'consume' && used.trim() !== '') {
      usedAmount = Number(used)
      if (!Number.isFinite(usedAmount) || usedAmount <= 0) {
        setError('How much you used must be a number more than 0, or leave it empty for all of it.')
        return
      }
    }
    setSaving(true)
    setError(null)
    const key = adjustKey({ kind, usedAmount })
    const err = await onAdjust({ id: initial.id, name: initial.name, unit: initial.unit }, kind, usedAmount, key)
    setSaving(false)
    if (err) setError(err)
  }

  const remove = async () => {
    if (!initial) return
    if (!confirm(`Remove ${initial.name} and its history? Use "Used it" or "Throw away" instead if you want to keep a record.`)) {
      return
    }
    if (isOffline()) {
      setError(OFFLINE_WRITE_MESSAGE)
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await postJson(
        `/api/inventory/${encodeURIComponent(initial.id)}`,
        undefined,
        deleteKey({ remove: initial.id }),
        'DELETE'
      )
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

  const tile = (active: boolean) =>
    cn(
      'relative min-h-[44px] flex items-center justify-center rounded-xl border px-2 text-subhead text-center cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--accent)] has-[:focus-visible]:ring-offset-2',
      active
        ? 'border-[var(--accent)] bg-[var(--accent-tint)] text-[var(--accent-text)] font-semibold'
        : 'border-[var(--surface-separator)] text-label-primary'
    )
  // Covers the whole tile, border included, so the hit target is >= 44px.
  const tileInput = 'absolute -left-px -top-px h-[calc(100%+2px)] w-[calc(100%+2px)] cursor-pointer opacity-0'

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

        {mode === 'edit' && initial && (
          <div className="rounded-xl border border-[var(--surface-separator)] p-3 space-y-3" data-testid="adjust-panel">
            <p className="text-subhead font-semibold text-label-primary">Used it or threw it away?</p>
            {initial.amount !== null && (
              <div>
                <label htmlFor={`${titleId}-used`} className="text-subhead text-label-secondary mb-1 block">
                  How much did you use? <span className="text-label-tertiary">(empty = all of it)</span>
                </label>
                <input
                  id={`${titleId}-used`}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  value={used}
                  onChange={(e) => setUsed(e.target.value)}
                  placeholder={`All ${amountText(initial) ?? ''}`.trim()}
                  className="w-full input-apple"
                />
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="btn-tinted min-h-[44px]" onClick={() => adjust('consume')} disabled={saving}>
                <Utensils className="w-4 h-4" aria-hidden="true" />
                <span>Used it</span>
              </button>
              <button type="button" className="btn-ghost min-h-[44px]" onClick={() => adjust('discard')} disabled={saving}>
                <Trash2 className="w-4 h-4" aria-hidden="true" />
                <span>Throw away</span>
              </button>
            </div>
          </div>
        )}

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
                <label key={loc} className={tile(location === loc)}>
                  <input
                    type="radio"
                    name={`${titleId}-location`}
                    value={loc}
                    checked={location === loc}
                    onChange={() => setLocation(loc)}
                    className={tileInput}
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

          <fieldset className="space-y-2">
            <legend className="text-subhead text-label-secondary mb-1">
              Date on the pack <span className="text-label-tertiary">(optional)</span>
            </legend>
            <div className="grid grid-cols-2 gap-2">
              {DATE_KINDS.map((kind) => (
                <label key={kind} className={tile(dateKind === kind)}>
                  <input
                    type="radio"
                    name={`${titleId}-date-kind`}
                    value={kind}
                    checked={dateKind === kind}
                    onChange={() => setDateKind(kind)}
                    className={tileInput}
                  />
                  {DATE_KIND_LABELS[kind]}
                </label>
              ))}
            </div>
            <p className="text-footnote text-label-secondary" id={`${titleId}-date-help`}>
              {dateKind === 'use_by'
                ? 'Use by is about safety: do not eat it after this day.'
                : 'Best before is about quality: it may still be fine after this day.'}
            </p>
            <div className="flex gap-2">
              <label htmlFor={`${titleId}-expires`} className="sr-only">
                {DATE_KIND_LABELS[dateKind]} date
              </label>
              <input
                id={`${titleId}-expires`}
                type="date"
                value={expiresOn}
                onChange={(e) => setExpiresOn(e.target.value)}
                aria-describedby={`${titleId}-date-help`}
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
          </fieldset>

          <div>
            <label htmlFor={`${titleId}-category`} className="text-subhead text-label-secondary mb-1 block">
              Category <span className="text-label-tertiary">(optional)</span>
            </label>
            <select
              id={`${titleId}-category`}
              value={category}
              onChange={(e) => setCategory(e.target.value as InventoryCategory | '')}
              className="w-full input-apple min-h-[44px]"
            >
              <option value="">No category</option>
              {INVENTORY_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor={`${titleId}-purchased`} className="text-subhead text-label-secondary mb-1 block">
                Bought <span className="text-label-tertiary">(optional)</span>
              </label>
              <input
                id={`${titleId}-purchased`}
                type="date"
                value={purchasedOn}
                onChange={(e) => setPurchasedOn(e.target.value)}
                className="w-full min-w-0 input-apple"
              />
            </div>
            <div>
              <label htmlFor={`${titleId}-opened`} className="text-subhead text-label-secondary mb-1 block">
                Opened <span className="text-label-tertiary">(optional)</span>
              </label>
              <input
                id={`${titleId}-opened`}
                type="date"
                value={openedOn}
                onChange={(e) => setOpenedOn(e.target.value)}
                className="w-full min-w-0 input-apple"
              />
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
