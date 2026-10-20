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
import { InventoryCookingSheet } from '@/components/inventory/InventoryCookingSheet'
import type { CookingReviewSource } from '@/lib/inventory-cooking-review-contract'
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
  type LucideIcon,
} from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/Skeleton'
import { useUndoToast } from '@/components/ui/toast'
import { useOnline } from '@/components/ui/use-online'
import { useDisplayLocale } from '@/components/ui/use-display-locale'
import { AddToGroceriesButton } from '@/components/meals/AddToGroceriesButton'
import { BarcodeFoodDialog } from '@/components/inventory/BarcodeFoodDialog'
import { FoodDescriptionDraft } from '@/components/inventory/FoodDescriptionDraft'
import { InventoryRestockSheet } from '@/components/inventory/InventoryRestockSheet'
import { InventoryRecoveryProvider, InventoryRecoveryPanel, useInventoryWrites, useInventoryRecoveryBlocked } from '@/components/inventory/InventoryRecovery'
import { makeInventoryChangeIntent, type InventoryChangeIntent } from '@/lib/inventory-change-client'
import type { InventoryChangeOperation } from '@/lib/inventory-change-contract'
import { readInventorySnapshot, INVENTORY_ITEM_PAGE_SIZE, INVENTORY_ITEM_MAX_PAGES, type InventoryReadAccess } from '@/lib/inventory-reader'
import { inventoryReadScopeValue } from '@/lib/inventory-read-scope'
import { makeInventoryIntakeIntent, readInventoryIntakeContext, type IntakeContext, type IntakeIntent } from '@/lib/inventory-intake-client'
import { ScanFridgeDialog } from './ScanFridgeDialog'
import { Dialog } from '@/components/ui/dialog'
import { usePendingFormNavigationController } from '@/components/layout/pending-form-navigation'
import { useFeatureEnabled } from '@/components/providers/features-provider'
import { cn } from '@/lib/utils'
import { formatDateOnly, toDateOnlyLocal } from '@/lib/dates'
import {
  DATE_KINDS,
  INVENTORY_CATEGORIES,
  INVENTORY_LOCATIONS,
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
import { inventoryFeedback as feedback, expiryFeedback, type InventoryFeedback } from '@/i18n/inventory'
import { InventoryText, useInventoryCopy } from './inventory-copy'

type Load<T> = { state: 'loading' } | { state: 'error' } | { state: 'ready'; data: T }

interface CookData {
  suggestions: CookSuggestion[]
  recipesConsidered: number
  truncated: boolean
  /** Some recipes or items were past the server's scan caps (older servers omit it). */
  inputsTruncated?: boolean
  matching?: 'presence_only'
  comparisonIncomplete?: boolean
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
  historyFailed?: boolean
}

export const OFFLINE_WRITE_MESSAGE = "You're offline. Connect to the internet to change the inventory."

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

// Dates and times on this page are display only, in the viewer's locale
// (useDisplayLocale): "Use by Oct 5" / "Use by 5 Oct", "10:42 AM" / "10:42".
// Stored day keys and form values stay YYYY-MM-DD.
function formatClock(date: Date, locale: string): string {
  return date.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
}

function formatAmount(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toPrecision(15)))
}

function amountText(item: Pick<InventoryItemDto, 'amount' | 'unit'>): string | null {
  if (item.amount === null && !item.unit) return null
  if (item.amount === null) return item.unit
  const n = formatAmount(item.amount)
  return item.unit ? `${n} ${item.unit}` : n
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
      <InventoryText feedback={expiryFeedback(expiryLabel(status, daysLeft, dateKind))} />
    </span>
  )
}

type AdjustKind = 'consume' | 'discard'
interface AdjustTarget {
  id: string
  name: string
  unit?: string | null
  version?: string
}

type PendingStockChange = {
  intent: InventoryChangeIntent
  operation: InventoryChangeOperation
  name: string
  unit?: string | null
  uncertain: boolean
}

type InventoryClientProps = {
  cookingSource?: CookingReviewSource
  canWrite: boolean
  canOpenRecipes: boolean
  intakeContext?: { userId: string; familyId: string }
  canScan?: boolean
  canCaptureDocuments?: boolean
  recoveryRequired?: boolean
}
export default function InventoryClient(props: InventoryClientProps) {
  return <InventoryRecoveryProvider required={props.recoveryRequired ?? false} original={props.intakeContext}><InventoryContent {...props} /></InventoryRecoveryProvider>
}
function InventoryContent({
  cookingSource,
  canWrite,
  canOpenRecipes,
  canScan = false,
  canCaptureDocuments = false,
  intakeContext,
}: InventoryClientProps) {
  const copy = useInventoryCopy()
  const { change: sendStockChange } = useInventoryWrites()
  const recoveryBlocked = useInventoryRecoveryBlocked()
  const readScope = intakeContext ? inventoryReadScopeValue(intakeContext) : undefined
  const originalReadScope = React.useRef(readScope).current
  const scopeRef = React.useRef(readScope)
  scopeRef.current = readScope
  const [readAccessLost, setReadAccessLost] = React.useState<InventoryReadAccess>(null)
  const readBlocked = readAccessLost !== null || readScope !== originalReadScope
  const blockedRef = React.useRef(readBlocked)
  blockedRef.current = readBlocked
  const readGeneration = React.useRef(0)
  const readRequest = React.useRef<AbortController | null>(null)
  const mounted = React.useRef(true)
  const [refreshing, setRefreshing] = React.useState(false)
  const readRecoveryRef = React.useRef<HTMLButtonElement>(null)
  React.useEffect(() => { if (readBlocked) readRecoveryRef.current?.focus() }, [readBlocked])
  const lastHistory = React.useRef<HistoryEntry[]>([])
  const mealsOn = useFeatureEnabled('meals')
  const listsOn = useFeatureEnabled('lists')
  const online = useOnline()
  const displayLocale = useDisplayLocale()
  const showUndo = useUndoToast()
  const [data, setData] = React.useState<Load<PageData>>({ state: 'loading' })
  const [loadedAt, setLoadedAt] = React.useState<Date | null>(null)
  const [refreshFailed, setRefreshFailed] = React.useState(false)
  const [editing, setEditing] = React.useState<{ mode: 'add' } | { mode: 'edit'; item: InventoryItemDto } | null>(null)
  const addItemRef = React.useRef<HTMLButtonElement>(null)
  const focusAddAfterEdit = React.useRef(false)
  const [notice, setNotice] = React.useState<{ text: InventoryFeedback; error?: boolean } | null>(null)
  const [scanning, setScanning] = React.useState(false)
  const [barcodeScanning, setBarcodeScanning] = React.useState(false)
  const [cookingOpen, setCookingOpen] = React.useState(!!cookingSource)
  React.useEffect(() => { setCookingOpen(!!cookingSource) }, [cookingSource?.kind, cookingSource?.id, cookingSource?.kind === 'recipe' ? cookingSource.servings : undefined])
  const [restockItem, setRestockItem] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [stockChange, setStockChange] = React.useState<PendingStockChange | null>(null)
  const stockChangeRef = React.useRef<PendingStockChange | null>(null)
  const stockFlight = React.useRef(false)
  const [stockSending, setStockSending] = React.useState(false)
  const stockNavigation = usePendingFormNavigationController(stockChange !== null)

  const [query, setQuery] = React.useState('')
  const [whereFilter, setWhereFilter] = React.useState<InventoryLocation | 'all'>('all')
  const [categoryFilter, setCategoryFilter] = React.useState<InventoryCategory | 'all'>('all')
  const hasData = React.useRef(false)

  // Run after the removed Dialog has restored its opener. A timer can fire
  // before that cleanup and have its focus overwritten by the old row.
  React.useEffect(() => {
    if (!editing && focusAddAfterEdit.current) {
      focusAddAfterEdit.current = false
      addItemRef.current?.focus()
    }
  }, [editing])

  const load = React.useCallback(async () => {
    const own = ++readGeneration.current
    readRequest.current?.abort()
    if (readScope !== originalReadScope) {
      setRefreshing(false)
      blockedRef.current = true
      setReadAccessLost('context')
      hasData.current = false
      lastHistory.current = []
      setLoadedAt(null)
      setData({ state: 'error' })
      return
    }
    if (isOffline()) { setRefreshing(false); if (!hasData.current) setData({ state: 'error' }); return }
    const request = new AbortController()
    readRequest.current = request
    const current = () => mounted.current && own === readGeneration.current
    setRefreshing(true)
    if (!hasData.current) setData({ state: 'loading' })
    try {
      const snapshot = await readInventorySnapshot({ scope: readScope, today: toDateOnlyLocal(new Date()), mealsOn, signal: request.signal })
      if (!current()) return
      if (snapshot.accessLost) {
        blockedRef.current = true
        setReadAccessLost(snapshot.accessLost)
        hasData.current = false
        lastHistory.current = []
        setLoadedAt(null)
        setData({ state: 'error' })
        return
      }
      const { list, useSoon: soon, cook: cooked, history } = snapshot
      if (list.state !== 'ready' || soon.state !== 'ready') {
        if (hasData.current) setRefreshFailed(true)
        else setData({ state: 'error' })
        return
      }
      blockedRef.current = false
      setReadAccessLost(null)
      hasData.current = true
      setRefreshFailed(false)
      setLoadedAt(new Date())
      if (history.state === 'ready') lastHistory.current = history.data.adjustments
      setData({ state: 'ready', data: { items: list.data.items, capped: list.data.capped, useSoon: soon.data.items, cook: cooked,
        history: history.state === 'ready' ? history.data.adjustments : lastHistory.current.map(entry => ({ ...entry, undoable: false })), historyFailed: history.state !== 'ready' } })
    } finally { if (current()) setRefreshing(false) }
  }, [mealsOn, readScope, originalReadScope])

  React.useEffect(() => {
    mounted.current = true
    void load()
    return () => { mounted.current = false; readGeneration.current++; readRequest.current?.abort() }
  }, [load])

  // Refresh when the connection comes back.
  const wasOnline = React.useRef(true)
  React.useEffect(() => {
    if (online && !wasOnline.current) load()
    wasOnline.current = online
  }, [online, load])

  const afterChange = async (message: InventoryFeedback) => {
    setEditing(null)
    setScanning(false)
    setNotice({ text: message })
    await load()
  }

  async function runStockChange(pending: PendingStockChange): Promise<InventoryFeedback | null> {
    if (blockedRef.current) return feedback('readScopeChanged')
    if (stockFlight.current || stockChangeRef.current !== pending) return feedback('stockChangePending')
    stockFlight.current = true
    setStockSending(true)
    const operation = pending.operation
    try {
      const result = await sendStockChange(pending.intent)
      if (result.kind === 'unknown' || (result.kind === 'refused' && pending.uncertain)) {
        pending.uncertain = true
        setStockChange({ ...pending })
        if (result.kind === 'refused') void load()
        return feedback('stockChangeUnknown')
      }
      stockChangeRef.current = null
      setStockChange(null)
      await stockNavigation.releaseBeforeNavigation()
      if (result.kind === 'confirmed') {
        if (operation.kind === 'edit' || operation.kind === 'remove') focusAddAfterEdit.current = true
        setEditing(null)
        await load()
        if (!mounted.current || blockedRef.current || scopeRef.current !== originalReadScope) return null
        if (operation.kind === 'undo') {
          setNotice({ text: feedback('undoSuccess', { name: pending.name }) })
        } else if (operation.kind === 'edit' || operation.kind === 'remove') {
          setNotice({ text: feedback(operation.kind === 'edit' ? 'savedName' : 'removedName', { name: pending.name }) })
        } else {
          const amount = operation.kind === 'consume' ? operation.amount : null
          const partial = amount !== null
          const params = { name: pending.name, amount: `${amount === null ? '' : formatAmount(amount)}${pending.unit ? ` ${pending.unit}` : ''}` }
          const title = feedback(operation.kind === 'discard' ? 'threwName' : partial ? 'usedAmount' : 'usedName', params)
          setNotice({ text: feedback('stockChangeConfirmed', { name: pending.name }) })
          if ('adjustmentId' in result.receipt) {
            const adjustmentId = result.receipt.adjustmentId
            showUndo({ title: <InventoryText feedback={title} />, onUndo: () => void undo(adjustmentId, pending.name) })
          }
        }
        return null
      }
      const message = feedback(result.kind === 'removed' ? 'stockChangeRemoved' : result.kind === 'not_applied' ? 'stockChangeNotApplied' : 'stockChangeRefused')
      if (result.kind === 'not_applied' || result.kind === 'removed') setEditing(null)
      setNotice({ text: message, error: true })
      await load()
      return message
    } finally {
      stockFlight.current = false
      setStockSending(false)
      setBusy(null)
    }
  }

  async function startStockChange(operation: InventoryChangeOperation, name: string, unit?: string | null): Promise<InventoryFeedback | null> {
    if (blockedRef.current || scopeRef.current !== originalReadScope) return feedback('readScopeChanged')
    if (stockChangeRef.current || stockFlight.current) return feedback('stockChangePending')
    if (isOffline()) return feedback('offlineWrite')
    if (!intakeContext) return feedback('stockChangeContext')
    let intent: InventoryChangeIntent
    try { intent = makeInventoryChangeIntent(operation, intakeContext) }
    catch { return feedback('stockChangeRefresh') }
    const pending = { intent, operation, name, unit, uncertain: false }
    stockChangeRef.current = pending
    setStockChange(pending)
    setBusy(operation.kind === 'undo' ? operation.adjustment_id : operation.item_id)
    return runStockChange(pending)
  }

  async function undo(adjustmentId: string, name: string) {
    const error = await startStockChange({ kind: 'undo', adjustment_id: adjustmentId }, name)
    if (error) setNotice({ text: error, error: true })
  }

  /** Reviewed amount uses the same loaded version/unit; no silent conversion or rebasing. */
  const adjust = async (target: AdjustTarget, kind: AdjustKind, amount: number | null = null): Promise<InventoryFeedback | null> => {
    const current = data.state === 'ready' ? data.data.items.find(item => item.id === target.id) : undefined
    const expectedVersion = target.version ?? current?.updated_at
    if (!expectedVersion) return feedback('stockChangeRefresh')
    return startStockChange(kind === 'consume' ? { kind, item_id: target.id, expected_version: expectedVersion, amount } : { kind, item_id: target.id, expected_version: expectedVersion }, target.name, target.unit ?? current?.unit)
  }

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
    if (recoveryBlocked) return
    if (isOffline()) {
      setNotice({ text: feedback('offlineWrite'), error: true })
      return
    }
    setEditing({ mode: 'add' })
  }

  return (
    <>
    {readBlocked && <EmptyState icon={WifiOff} title={copy('readAccessTitle')} description={copy(readAccessLost === 'unsupported' ? 'readScopeUnsupported' : 'readScopeChanged')} action={<button type="button" className="btn-tinted min-h-[44px]" ref={readRecoveryRef} disabled={refreshing} onClick={() => { if (readScope !== originalReadScope) window.location.reload(); else void load() }}>{copy(readScope !== originalReadScope ? 'readReopen' : 'tryAgain')}</button>} />}
    <div hidden={readBlocked} inert={readBlocked} className="min-w-0 space-y-6">
      <InventoryRecoveryPanel suspended={readBlocked} onChanged={() => void load()} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-large-title font-display">{copy('title')}</h1>
          <p className="text-subhead text-label-secondary mt-0.5">
            {copy('subtitle')}
          </p>
        </div>
        <button type="button" className="btn-plain min-h-[44px]" disabled={refreshing || !online} onClick={() => void load()}>{copy(refreshing ? 'readRefreshing' : 'readRefresh')}</button>
        {(canWrite || canScan) && (
          <div className="flex flex-wrap gap-2">
            {canScan && (
              <button type="button" className="btn-tinted min-h-[44px]" disabled={recoveryBlocked} onClick={() => setScanning(true)}>
                <Camera className="w-4 h-4" aria-hidden="true" />
                <span>{copy('scanFridge')}</span>
              </button>
            )}
            {canWrite && <button type="button" className="btn-tinted min-h-[44px]" disabled={recoveryBlocked} onClick={() => setBarcodeScanning(true)}>{copy('scanFood')}</button>}
            {canWrite && (
              <button ref={addItemRef} type="button" className="btn-tinted min-h-[44px]" disabled={recoveryBlocked} onClick={openAdd}>
                <Plus className="w-4 h-4" aria-hidden="true" />
                <span>{copy('addItem')}</span>
              </button>
            )}
          </div>
        )}
      </div>

      <div role="status" aria-live="polite" className="empty:hidden" data-testid="inventory-notice">
        {notice && (
          <p className={cn('text-subhead', notice.error ? 'text-[var(--danger-text)]' : 'text-label-secondary')}>
            <InventoryText feedback={notice.text} />
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
              ? copy('savedOffline', { time: formatClock(loadedAt, displayLocale) })
              : copy('stale', { time: formatClock(loadedAt, displayLocale) })}
          </span>
          {online && (
            <button type="button" className="btn-tinted min-h-[44px]" onClick={load}>
              {copy('tryAgain')}
            </button>
          )}
        </div>
      )}

      {data.state === 'error' ? (
        <EmptyState
          icon={online ? Refrigerator : WifiOff}
          glyphColor="meals"
          title={copy('loadFailed')}
          description={online ? copy('connectionRetry') : copy('loadOffline')}
          action={
            <button type="button" className="btn-tinted min-h-[44px]" onClick={load}>
              {copy('tryAgain')}
            </button>
          }
        />
      ) : data.state === 'loading' ? (
        <div className="space-y-3" role="status" aria-label={copy('loading')}>
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
          <div className="grid min-w-0 grid-cols-1 items-start gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]" data-testid="inventory-overview">
            <InventoryLocations
              items={data.data.items}
              where={whereFilter}
              onWhere={setWhereFilter}
              capped={data.data.capped}
            />
            <UseSoonSection
              acrossLocations={whereFilter !== 'all'}
              items={data.data.useSoon}
              canWrite={canWrite}
              busy={busy}
              onAdjust={(t, kind) => quickAdjust(t, kind)}
            />
          </div>
          {data.data.items.length === 0 ? (
            <EmptyState
              icon={Refrigerator}
              glyphColor="meals"
              title={copy('nothingTracked')}
              description={
                canWrite
                  ? copy('emptyWriter')
                  : copy('emptyReader')
              }
              action={
                canWrite ? (
                  <button type="button" className="btn-tinted min-h-[44px]" onClick={openAdd}>
                    <Plus className="w-4 h-4" aria-hidden="true" />
                    <span>{copy('addItem')}</span>
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
                  {copy('capped', { count: (INVENTORY_ITEM_PAGE_SIZE * INVENTORY_ITEM_MAX_PAGES).toLocaleString(displayLocale) })}
                </p>
              )}
              {filtersOn && filtered.length === 0 ? (
                <div className="card-apple p-4 flex flex-wrap items-center justify-between gap-2" data-testid="no-matches">
                  <p className="text-subhead text-label-secondary">{copy('noMatches')}</p>
                  <button type="button" className="btn-tinted min-h-[44px]" onClick={clearFilters}>
                    {copy('clearSearch')}
                  </button>
                </div>
              ) : (
                <div className={cn('grid min-w-0 grid-cols-1 items-start gap-6', whereFilter === 'all' && 'xl:grid-cols-3')}>
                  {INVENTORY_LOCATIONS.filter((loc) => whereFilter === 'all' || whereFilter === loc).map((loc) => (
                    <LocationSection
                      key={loc}
                      location={loc}
                      items={grouped[loc]}
                      canWrite={canWrite}
                      filtered={filtersOn}
                      onEdit={(item) => setEditing({ mode: 'edit', item })}
                    />
                  ))}
                </div>
              )}
            </>
          )}
          {(mealsOn || data.data.history.length > 0 || data.data.historyFailed) && (
            <div className={cn('grid min-w-0 grid-cols-1 items-start gap-6', mealsOn && data.data.history.length > 0 && 'xl:grid-cols-2')} data-testid="inventory-secondary">
              {mealsOn && <CookSection load={data.data.cook} onRetry={load} canOpenRecipes={canOpenRecipes} />}
              {data.data.historyFailed && <p role="status" className="card-apple p-4 text-subhead">{copy(data.data.history.length ? 'readHistoryUnavailable' : 'readHistoryUnavailableEmpty')}</p>}
              {data.data.history.length > 0 && (
                <HistorySection entries={data.data.history} canWrite={canWrite} onUndo={(e) => undo(e.id, e.item_name)} onRestock={listsOn && intakeContext && !recoveryBlocked ? (e) => setRestockItem(e.item_id) : undefined} />
              )}
            </div>
          )}
        </>
      )}

      {stockChange && <Dialog open={!readBlocked} variant="form" title={copy(stockSending ? 'stockChangeSaving' : 'stockChangeRecovery')} testId="inventory-change-recovery">
        <p className="text-body break-words">{stockChange.name}</p>
        <p className="text-subhead">{copy(stockChange.operation.kind === 'undo' ? 'undo' : stockChange.operation.kind === 'discard' ? 'throwAway' : stockChange.operation.kind === 'edit' ? 'save' : stockChange.operation.kind === 'remove' ? 'remove' : 'usedIt')}</p>
        {stockChange.operation.kind === 'consume' && stockChange.operation.amount !== null && <p className="text-subhead">{formatAmount(stockChange.operation.amount)} {stockChange.unit ?? ''}</p>}
        <StockEditSummary operation={stockChange.operation} />
        {stockChange.operation.kind === 'remove' && <p className="text-footnote">{copy('removeConfirm', { name: stockChange.name })}</p>}
        <p role="status" className="text-footnote">{copy(stockSending ? 'stockChangeSaving' : 'stockChangeUnknown')}</p>
        <button type="button" className="btn-tinted min-h-[44px] w-full" disabled={stockSending} onClick={() => { const pending = stockChangeRef.current; if (pending) void runStockChange(pending); }}>{copy(stockSending ? 'saving' : 'intakeRetry')}</button>
      </Dialog>}

      {barcodeScanning && <BarcodeFoodDialog onVerifyAccess={() => void load()} suspended={readBlocked} initialContext={intakeContext} onClose={() => setBarcodeScanning(false)} onDone={(count) => { setBarcodeScanning(false); afterChange(feedback('barcodeAdded', { count })); }} />}
      {scanning && <ScanFridgeDialog onVerifyAccess={() => void load()} suspended={readBlocked} canCaptureDocuments={canCaptureDocuments} initialContext={intakeContext} onClose={() => setScanning(false)} onDone={(message) => afterChange({ raw: message })} onFeedback={afterChange} />}

      {cookingOpen && cookingSource && mealsOn && canWrite && intakeContext && <InventoryCookingSheet key={JSON.stringify(cookingSource)} source={cookingSource} context={intakeContext} items={ready?.items ?? []} capped={ready?.capped ?? false} suspended={readBlocked || !!editing || !!stockChange} disabled={recoveryBlocked || refreshing || refreshFailed || !ready} onClose={() => setCookingOpen(false)} onChoose={item => { if (!readBlocked && !recoveryBlocked && !refreshing && !refreshFailed) setEditing({ mode: 'edit', item }) }} />}

      {editing && (
        <ItemModal
          mode={editing.mode}
          suspended={readBlocked}
          onVerifyAccess={() => void load()}
          initialContext={intakeContext}
          initial={editing.mode === 'edit' ? editing.item : undefined}
          onRestock={editing.mode === 'edit' && listsOn && intakeContext && !recoveryBlocked ? () => setRestockItem(editing.item.id) : undefined}
          onClose={() => setEditing(null)}
          onDone={(message) => {
            focusAddAfterEdit.current = true
            void afterChange(message)
          }}
          onAdjust={adjust}
          onChangeStock={startStockChange}
        />
      )}
      {restockItem && <InventoryRestockSheet key={restockItem} itemId={restockItem} context={intakeContext} suspended={readBlocked} disabled={recoveryBlocked} onClose={() => setRestockItem(null)} onChanged={() => void load()} />}
    </div>
    </>
  )
}


/** Shortcuts share the existing location filter; counts describe loaded stock,
 * not a new persisted view or an estimate of unreturned inventory. */
function InventoryLocations({ items, where, onWhere, capped }: {
  items: InventoryItemDto[]
  where: InventoryLocation | 'all'
  onWhere: (location: InventoryLocation | 'all') => void
  capped: boolean
}) {
  const copy = useInventoryCopy()
  const locale = useDisplayLocale()
  const counts = { all: items.length, fridge: 0, freezer: 0, pantry: 0 }
  for (const item of items) counts[item.location] += 1
  const locations = ['all', ...INVENTORY_LOCATIONS] as const
  const countLabel = (count: number) => {
    const key = capped
      ? count === 0 ? 'locationCountIncomplete' : count === 1 ? 'locationCountCappedOne' : 'locationCountCapped'
      : count === 1 ? 'locationCountOne' : 'locationCountMany'
    return copy(key, { count: count.toLocaleString(locale) })
  }
  return (
    <section aria-labelledby="inventory-locations" className="min-w-0" data-testid="inventory-shortcuts">
      <h2 id="inventory-locations" className="section-header">{copy('locations')}</h2>
      <div className="card-apple grid grid-cols-2 gap-2 p-3 md:grid-cols-1">
        {locations.map((location) => (
          <button
            key={location}
            type="button"
            aria-pressed={where === location}
            onClick={() => onWhere(location)}
            className={cn('flex min-h-[44px] w-full min-w-0 flex-col items-start justify-between gap-1 rounded-[var(--radius-md)] md:flex-row md:items-center md:gap-3 px-3 py-2 text-left text-subhead focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-text)]', where === location ? 'bg-accent-fill text-on-accent' : 'bg-[var(--surface-fill)] text-label-primary')}
          >
            <span className={cn('min-w-0 [overflow-wrap:anywhere]', where === location ? 'text-on-accent' : 'text-label-primary')}>{copy(location === 'all' ? 'everywhere' : location)}</span>
            <span className={cn('min-w-0 max-w-full text-footnote [overflow-wrap:anywhere] md:max-w-[60%] md:text-right', where === location ? 'text-on-accent' : 'text-label-primary')}>{countLabel(counts[location])}</span>
          </button>
        ))}
      </div>
    </section>
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
  const copy = useInventoryCopy()
  const locale = useDisplayLocale()
  return (
    <section aria-labelledby="inventory-past-use-by" data-testid="past-use-by">
      <h2 id="inventory-past-use-by" className="section-header">
        {copy('pastUseBy')}
      </h2>
      <div className="card-apple overflow-hidden">
        <p className="px-4 pt-3 text-footnote text-label-secondary">
          {copy('pastSafety')}
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
                  {copy(item.location)} · {copy('use_by')} {item.expires_on ? formatDateOnly(item.expires_on, undefined, locale) : ''}
                </span>
              </span>
              <ExpiryBadge status={item.expiry.status} daysLeft={item.expiry.daysLeft} dateKind={item.date_kind} />
              {canWrite && (
                <ActionButton
                  icon={Trash2}
                  disabled={busy === item.id}
                  label={copy('throwAwayName', { name: item.name })}
                  onClick={() => onDiscard({ id: item.id, name: item.name })}
                >
                  {copy('throwAway')}
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
  acrossLocations = false,
  items,
  canWrite,
  busy,
  onAdjust,
}: {
  acrossLocations?: boolean
  items: UseSoonItem[]
  canWrite: boolean
  busy: string | null
  onAdjust: (target: AdjustTarget, kind: AdjustKind) => void
}) {
  const copy = useInventoryCopy()
  const locale = useDisplayLocale()
  return (
    <section aria-labelledby="inventory-use-soon" data-testid="use-soon">
      <h2 id="inventory-use-soon" className="section-header">
        {copy('useSoon')}
      </h2>
      {acrossLocations && <p className="mb-2 text-footnote text-label-secondary">{copy('useSoonAllLocations')}</p>}
      <div className="card-apple overflow-hidden">
        {items.length === 0 ? (
          <p className="p-4 text-subhead text-label-secondary">{copy('nothingSoon')}</p>
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
                    {copy(item.location)} · {copy(asDateKind(item.dateKind))}{' '}
                    {formatDateOnly(item.expiresOn, undefined, locale)}
                  </span>
                </span>
                <ExpiryBadge status={item.status} daysLeft={item.daysLeft} dateKind={asDateKind(item.dateKind)} />
                {canWrite && (
                  <span className="flex flex-wrap gap-2">
                    <ActionButton
                      icon={Utensils}
                      disabled={busy === item.id}
                      label={copy('usedName', { name: item.name })}
                      onClick={() => onAdjust({ id: item.id, name: item.name }, 'consume')}
                    >
                      {copy('usedIt')}
                    </ActionButton>
                    <ActionButton
                      icon={Trash2}
                      disabled={busy === item.id}
                      label={copy('throwAwayName', { name: item.name })}
                      onClick={() => onAdjust({ id: item.id, name: item.name }, 'discard')}
                    >
                      {copy('throwAway')}
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
  const copy = useInventoryCopy()
  const id = React.useId()
  return (
    <div role="search" aria-label={copy('searchInventory')} className="card-apple p-3 space-y-3" data-testid="inventory-filters">
      <div className="relative">
        <label htmlFor={`${id}-q`} className="sr-only">
          {copy('searchName')}
        </label>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-label-tertiary" aria-hidden="true" />
        <input
          id={`${id}-q`}
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          maxLength={100}
          placeholder={copy('searchName')}
          className="w-full input-apple min-h-[44px] pl-9"
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-where`} className="text-footnote text-label-secondary mb-1 block">
            {copy('where')}
          </label>
          <select
            id={`${id}-where`}
            value={where}
            onChange={(e) => onWhere(e.target.value as InventoryLocation | 'all')}
            className="w-full input-apple min-h-[44px]"
          >
            <option value="all">{copy('everywhere')}</option>
            {INVENTORY_LOCATIONS.map((loc) => (
              <option key={loc} value={loc}>
                {copy(loc)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-category`} className="text-footnote text-label-secondary mb-1 block">
            {copy('category')}
          </label>
          <select
            id={`${id}-category`}
            value={category}
            onChange={(e) => onCategory(e.target.value as InventoryCategory | 'all')}
            className="w-full input-apple min-h-[44px]"
          >
            <option value="all">{copy('allCategories')}</option>
            {INVENTORY_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {copy(c)}
              </option>
            ))}
          </select>
        </div>
      </div>
      {filtersOn && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-footnote text-label-secondary" data-testid="filter-count">
            {copy('filterCount', { shown, total })}
          </p>
          <button type="button" className="btn-plain min-h-[44px]" onClick={onClear}>
            {copy('clearSearch')}
          </button>
        </div>
      )}
    </div>
  )
}

function CookSection({ load, onRetry, canOpenRecipes }: { load: Load<CookData>; onRetry: () => void; canOpenRecipes: boolean }) {
  const copy = useInventoryCopy()
  return (
    <section aria-labelledby="inventory-cook" data-testid="what-can-i-cook">
      <h2 id="inventory-cook" className="section-header">
        {copy('cook')}
      </h2>
      {load.state === 'loading' ? (
        <div className="card-apple p-4 space-y-2" role="status" aria-label={copy('loadingRecipes')}>
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      ) : load.state === 'error' ? (
        <div className="card-apple p-4 flex flex-wrap items-center justify-between gap-2">
          <p className="text-subhead text-[var(--danger-text)]">{copy('recipesFailed')}</p>
          <button type="button" className="btn-tinted min-h-[44px]" onClick={onRetry}>
            {copy('tryAgain')}
          </button>
        </div>
      ) : load.data.suggestions.length === 0 ? (
        <p className="card-apple p-4 text-subhead text-label-secondary" data-testid="cook-empty">
          {load.data.comparisonIncomplete ? copy('cookComparisonIncomplete') : load.data.inputsTruncated
            ? copy('recipesEmptyCapped')
            : copy('recipesEmpty')}
        </p>
      ) : (
        <>
          {load.data.inputsTruncated && (
            <p className="mb-3 text-footnote text-label-secondary" data-testid="cook-incomplete">
              {copy('recipesIncomplete')}
            </p>
          )}
          {load.data.comparisonIncomplete && <p className="mb-3 text-footnote" role="status">{copy('cookComparisonIncomplete')}</p>}
          <p className="mb-3 text-footnote text-label-secondary">{copy('cookPresenceOnly')}</p>
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
                        ? copy(s.totalCount === 1 ? 'haveAllOne' : 'haveAllMany', { count: s.totalCount })
                        : copy('haveSome', { have: s.haveCount, total: s.totalCount })}
                      {s.useSoonCount > 0 ? copy(s.useSoonCount === 1 ? 'cookSoonOne' : 'cookSoonMany', { count: s.useSoonCount }) : ''}
                    </p>
                  </div>
                </div>
                <p className="text-subhead text-label-primary break-words">
                  <span className="font-semibold">{copy('inStock')}</span>
                  {s.have.map((h) => h.name).join(', ')}
                </p>
                {s.missing.length > 0 && (
                  <p className="text-subhead text-label-primary break-words" data-testid="cook-missing">
                    <span className="font-semibold">{copy('missing')}</span>
                    {s.missing.map((m) => m.name).join(', ')}
                  </p>
                )}
                <details className="rounded-xl bg-[var(--surface-fill)] px-3">
                  <summary className="min-h-[44px] cursor-pointer py-3 text-footnote">{copy('cookMatchDetails')}</summary>
                  {s.have.some(item => item.match === undefined) && <p className="mb-2 text-footnote">{copy('cookMatchUnknown')}</p>}
                  <ul className="pb-3 space-y-2">{s.have.map(item => <li key={item.ingredientId} className="text-footnote break-words"><span className="font-semibold">{item.name}</span>{' · '}{copy(item.match === 'linked' ? 'cookMatchLinked' : item.match === 'name' ? 'cookMatchName' : 'cookMatchUnknown')}</li>)}</ul>
                </details>
                <div className="flex flex-wrap items-start gap-2">
                  {canOpenRecipes && (
                    <Link
                      href={`/dashboard/meals/recipes/${encodeURIComponent(s.recipeId)}`}
                      className="inline-flex min-h-[44px] items-center gap-1.5 text-subhead text-[var(--accent-text)]"
                    >
                      <BookOpen className="w-4 h-4" aria-hidden="true" />
                      <span>
                        {copy('viewRecipe')}<span className="sr-only">: {s.title}</span>
                      </span>
                    </Link>
                  )}
                  <AddToGroceriesButton
                      className="flex-1 min-w-[14rem]"
                      recipeId={s.recipeId}
                      ingredientIds={s.missing.length ? s.missing.map((m) => m.ingredientId) : undefined}
                      label={s.missing.length ? copy('addMissing', { count: s.missing.length }) : copy('cookReviewGroceries')}
                  />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

function itemMeta(item: InventoryItemDto, locale: string, copy: ReturnType<typeof useInventoryCopy>): string {
  const parts: string[] = []
  const amount = amountText(item)
  if (amount) parts.push(amount)
  if (item.expires_on) parts.push(`${copy(asDateKind(item.date_kind))} ${formatDateOnly(item.expires_on, undefined, locale)}`)
  const category = asCategory(item.category)
  if (category) parts.push(copy(category))
  if (item.opened_on) parts.push(copy('openedDate', { date: formatDateOnly(item.opened_on, undefined, locale) }))
  return parts.join(' · ') || copy('noAmountDate')
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
  const copy = useInventoryCopy()
  const locale = useDisplayLocale()
  return (
    <section aria-labelledby={headingId} data-testid="inventory-location" data-location={location}>
      <h2 id={headingId} className="section-header">
        {copy(location)} <span className="text-label-tertiary">({items.length})</span>
      </h2>
      <div className="card-apple overflow-hidden">
        {items.length === 0 ? (
          <p className="p-4 text-subhead text-label-secondary">
            {copy(filtered ? ({ fridge: 'matchesFridge', freezer: 'matchesFreezer', pantry: 'matchesPantry' } as const)[location] : ({ fridge: 'nothingFridge', freezer: 'nothingFreezer', pantry: 'nothingPantry' } as const)[location])}
          </p>
        ) : (
          <ul className="divide-y divide-[var(--surface-separator)]">
            {items.map((item) => {
              const body = (
                <>
                  {/* A minimum width lets the badge wrap under a long name on a phone instead of squeezing it. */}
                  <span className="flex-1 min-w-[9rem]">
                    <span className="block text-body text-label-primary break-words">{item.name}</span>
                    <span className="block text-footnote text-label-secondary break-words">{itemMeta(item, locale, copy)}</span>
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
                      aria-label={copy('editName', { name: item.name })}
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

function historyText(e: HistoryEntry): InventoryFeedback {
  if (e.kind === 'discard') return feedback('threwName', { name: e.item_name })
  if (e.status_after === 'active' && e.amount_delta !== null) {
    return feedback('usedAmount', { amount: formatAmount(-e.amount_delta), name: e.item_name })
  }
  return feedback('usedName', { name: e.item_name })
}

function historyCopy(e: HistoryEntry, copy: ReturnType<typeof useInventoryCopy>): string {
  const value = historyText(e)
  return 'raw' in value ? value.raw : copy(value.key, value.params)
}

function HistorySection({
  entries,
  canWrite,
  onUndo,
  onRestock,
}: {
  entries: HistoryEntry[]
  canWrite: boolean
  onUndo: (entry: HistoryEntry) => void
  onRestock?: (entry: HistoryEntry) => void
}) {
  const copy = useInventoryCopy()
  const locale = useDisplayLocale()
  return (
    <section aria-labelledby="inventory-history" data-testid="inventory-history">
      <h2 id="inventory-history" className="section-header">
        {copy('history')}
      </h2>
      <div className="card-apple overflow-hidden">
        <ul className="divide-y divide-[var(--surface-separator)]">
          {entries.map((e) => (
            <li key={e.id} data-testid="history-item" className="px-4 py-3 min-h-[52px] flex flex-wrap items-center gap-x-3 gap-y-2">
              <History className="w-4 h-4 shrink-0 text-label-tertiary" aria-hidden="true" />
              <span className="flex-1 min-w-[10rem]">
                <span className="block text-body text-label-primary break-words"><InventoryText feedback={historyText(e)} /></span>
                <span className="block text-footnote text-label-secondary">
                  {new Date(e.created_at).toLocaleString(locale, {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                  {e.undone_at ? copy('undone') : ''}
                </span>
              </span>
              {canWrite && e.undoable === true && (
                <ActionButton icon={Undo2} label={copy('undoHistory', { change: historyCopy(e, copy) })} onClick={() => onUndo(e)}>
                  {copy('undo')}
                </ActionButton>
              )}
              {canWrite && onRestock && e.item_id && !e.undone_at && <button type="button" className="btn-plain min-h-[44px]" onClick={() => onRestock(e)}>{copy('restock')}</button>}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function StockEditSummary({ operation }: { operation: InventoryChangeOperation }) {
  const copy = useInventoryCopy()
  if (operation.kind !== 'edit') return null
  const changes = operation.changes
  const blank = copy('stockChangeNotRecorded')
  const fields: Array<[string, string]> = []
  if (changes.name !== undefined) fields.push([copy('name'), changes.name])
  if (changes.location !== undefined) fields.push([copy('where'), copy(changes.location)])
  if (changes.amount !== undefined) fields.push([copy('amount'), changes.amount === null ? blank : formatAmount(changes.amount)])
  if (changes.unit !== undefined) fields.push([copy('unit'), changes.unit || blank])
  if (changes.expires_on !== undefined) fields.push([copy('packDate'), changes.expires_on || blank])
  if (changes.date_kind !== undefined) fields.push([copy('foodPhotoDateKind'), copy(changes.date_kind)])
  if (changes.category !== undefined) fields.push([copy('category'), changes.category ? copy(changes.category) : blank])
  if (changes.purchased_on !== undefined) fields.push([copy('bought'), changes.purchased_on || blank])
  if (changes.opened_on !== undefined) fields.push([copy('opened'), changes.opened_on || blank])
  return <details className="rounded-xl bg-[var(--surface-fill)] p-3"><summary className="min-h-[44px] cursor-pointer py-2">{copy('stockChangeReviewedDetails')}</summary><dl className="space-y-2">{fields.map(([label, value]) => <div key={label} className="grid grid-cols-2 gap-3 text-footnote"><dt>{label}</dt><dd className="break-words">{value}</dd></div>)}</dl></details>
}

function ItemModal({
  mode,
  suspended = false,
  onVerifyAccess,
  initial,
  initialContext,
  onClose,
  onDone,
  onAdjust,
  onChangeStock,
  onRestock,
}: {
  mode: 'add' | 'edit'
  suspended?: boolean
  onVerifyAccess?: () => void
  initial?: InventoryItemDto
  initialContext?: IntakeContext
  onClose: () => void
  onDone: (message: InventoryFeedback) => void
  onChangeStock: (operation: InventoryChangeOperation, name: string) => Promise<InventoryFeedback | null>
  onRestock?: () => void
  onAdjust: (
    target: AdjustTarget,
    kind: AdjustKind,
    amount: number | null,
  ) => Promise<InventoryFeedback | null>
}) {
  const copy = useInventoryCopy()
  const [name, setName] = React.useState(initial?.name ?? '')
  const { intake: sendIntake } = useInventoryWrites()
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
  const [error, setError] = React.useState<InventoryFeedback | null>(null)
  const titleId = React.useId()
  const nameRef = React.useRef<HTMLInputElement>(null)
  const keepRef = React.useRef<HTMLButtonElement>(null)
  const mutationRef = React.useRef(false)
  const [showRemove, setShowRemove] = React.useState(false)
  const [showDetails, setShowDetails] = React.useState(
    Boolean(initial?.category || initial?.purchased_on || initial?.opened_on),
  )
  // Freeze the actor/family captured when the sheet opened; never rebase a save.
  const [context, setContext] = React.useState<IntakeContext | null>(initialContext ?? null)
  const createAttempt = React.useRef<IntakeIntent | null>(null)
  const [uncertain, setUncertain] = React.useState(false)
  const locked = saving || uncertain
  React.useEffect(() => {
    if (mode !== 'add' || initialContext) return
    let active = true
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10000)
    void readInventoryIntakeContext(controller.signal).then((value) => {
      if (active) setContext(value)
    }).catch(() => {
      if (active) setError(feedback('manualIntakeContextFailed'))
    }).finally(() => clearTimeout(timer))
    return () => { active = false; clearTimeout(timer); controller.abort() }
  }, [mode, initialContext])

  // Keep browser Back on this route while the item mutation is in flight.
  // The local close path below also guards Escape/backdrop/close-button
  // dismissal so an in-flight draft cannot be discarded.
  const navigation = usePendingFormNavigationController(locked)

  const guardedClose = React.useCallback(() => {
    if (mutationRef.current || createAttempt.current) return
    onClose()
  }, [onClose])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (mutationRef.current || suspended) return
    const trimmed = name.trim()
    if (!trimmed) {
      setError(feedback('enterName'))
      return
    }
    const parsedAmount = amount.trim() === '' ? null : Number(amount)
    if (parsedAmount !== null && (!Number.isFinite(parsedAmount) || parsedAmount < 0)) {
      setError(feedback('amountInvalid'))
      return
    }
    if (isOffline()) {
      setError(feedback('offlineWrite'))
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
    if (mode === 'add') {
      if (!context) { setError(feedback('manualIntakeContextFailed')); return }
      if (!createAttempt.current) {
        try { createAttempt.current = makeInventoryIntakeIntent(body, context) }
        catch { setError(feedback('manualIntakeInvalid')); return }
      }
      mutationRef.current = true
      setSaving(true)
      setError(null)
      try {
        const wasUncertain = uncertain
        const result = await sendIntake(createAttempt.current)
        if (result.kind === 'refused' && result.accessChanged) onVerifyAccess?.()
        if (result.kind === 'confirmed') {
          createAttempt.current = null
          setUncertain(false)
          await navigation.releaseBeforeNavigation()
          onDone(feedback('addedName', { name: trimmed }))
        } else if (result.kind === 'removed') {
          createAttempt.current = null
          setUncertain(false)
          setError(feedback('manualIntakeRemoved'))
          await navigation.releaseBeforeNavigation()
        } else if (result.kind === 'unknown' || wasUncertain) {
          setUncertain(true)
          setError(feedback('manualIntakeUnknown'))
        } else {
          createAttempt.current = null
          setError(feedback('manualIntakeRefused'))
          await navigation.releaseBeforeNavigation()
        }
      } finally {
        mutationRef.current = false
        setSaving(false)
      }
      return
    }
    mutationRef.current = true
    setSaving(true)
    setError(null)
    try {
      if (!initial) return
      const err = await onChangeStock({ kind: 'edit', item_id: initial.id, expected_version: initial.updated_at, changes: body }, trimmed)
      if (err) setError(err)
    } catch {
      setError(feedback('stockChangeUnknown'))
    } finally {
      mutationRef.current = false
      setSaving(false)
    }
  }

  const adjust = async (kind: AdjustKind) => {
    if (!initial || mutationRef.current || suspended) return
    let usedAmount: number | null = null
    if (kind === 'consume' && used.trim() !== '') {
      usedAmount = Number(used)
      if (!Number.isFinite(usedAmount) || usedAmount <= 0) {
        setError(feedback('usedInvalid'))
        return
      }
    }
    mutationRef.current = true
    setSaving(true)
    setError(null)
    try {
      const err = await onAdjust({ id: initial.id, name: initial.name, unit: initial.unit, version: initial.updated_at }, kind, usedAmount)
      if (err) setError(err)
    } catch {
      setError(feedback('saveNetwork'))
    } finally {
      mutationRef.current = false
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!initial || mutationRef.current || suspended || !showRemove) return
    if (isOffline()) {
      setError(feedback('offlineWrite'))
      return
    }
    mutationRef.current = true
    setSaving(true)
    setError(null)
    try {
      const err = await onChangeStock({ kind: 'remove', item_id: initial.id, expected_version: initial.updated_at }, initial.name)
      if (err) setError(err)
    } catch {
      setError(feedback('stockChangeUnknown'))
    } finally {
      mutationRef.current = false
      setSaving(false)
    }
  }

  const closeRemove = () => {
    if (mutationRef.current) return
    setShowRemove(false)
    setError(null)
  }

  const tile = (active: boolean) =>
    cn(
      'relative min-h-[44px] flex items-center justify-center rounded-xl border px-2 text-subhead text-center cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--accent)] has-[:focus-visible]:ring-offset-2',
      active
        ? 'border-[var(--accent)] bg-[var(--accent-tint)] text-[var(--accent-text)] font-semibold'
        : 'border-[var(--surface-separator)] text-label-primary',
    )
  // Covers the whole tile, border included, so the hit target is >= 44px.
  const tileInput = 'absolute -left-px -top-px h-[calc(100%+2px)] w-[calc(100%+2px)] cursor-pointer opacity-0'

  return (
    <Dialog
      open={!suspended}
      variant="form"
      testId="inventory-modal"
      title={mode === 'add' ? copy('addItem') : copy('editName', { name: initial?.name ?? copy('itemFallback') })}
      closeLabel={copy('close')}
      initialFocusRef={nameRef}
      onClose={locked ? undefined : guardedClose}
      footer={
        <div className="flex gap-2">
          {mode === 'edit' && (
            <button
              type="button"
              onClick={() => {
                if (!mutationRef.current) {
                  setError(null)
                  setShowRemove(true)
                }
              }}
              className="btn-destructive flex-1 min-h-[44px]"
              disabled={saving}
            >
              {copy('remove')}
            </button>
          )}
          <button type="submit" form={titleId} className="btn-tinted flex-1 min-h-[44px]" disabled={saving}>
            {copy(saving ? 'saving' : uncertain ? 'intakeRetry' : 'save')}
          </button>
        </div>
      }
    >
      {(initial?.barcode || initial?.package_size) && <details className="rounded-xl bg-[var(--surface-fill)] p-3">
        <summary className="min-h-[44px] cursor-pointer py-2">{copy('productDetails')}</summary>
        {initial.barcode && <p className="text-footnote break-all">{copy('productCode')}: {initial.barcode}</p>}
        {initial.product_brand && <p className="text-subhead">{initial.product_brand}</p>}
        {initial.package_size && <p className="text-subhead">{copy('packageSize')}: {initial.package_size}</p>}
        <p className="text-footnote text-label-secondary">{copy('packageNotStock')}</p>
        {initial.product_source && initial.barcode && <a href={`https://world.openfoodfacts.org/product/${encodeURIComponent(initial.barcode)}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[44px] items-center">Open Food Facts · ODbL ↗</a>}
      </details>}
      {mode === 'edit' && initial && (
        <div className="rounded-xl border border-[var(--surface-separator)] p-3 space-y-3" data-testid="adjust-panel">
          <p className="text-subhead font-semibold text-label-primary">{copy('usedOrThrew')}</p>
          {initial.amount !== null && (
            <div>
              <label htmlFor={`${titleId}-used`} className="text-subhead text-label-secondary mb-1 block">
                {copy('howMuch')}
                <span className="text-label-tertiary">{copy('emptyAll')}</span>
              </label>
              <input
                id={`${titleId}-used`}
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                value={used}
                disabled={saving}
                onChange={(e) => setUsed(e.target.value)}
                placeholder={copy('allAmount', { amount: amountText(initial) ?? '' }).trim()}
                className="w-full input-apple"
              />
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className="btn-tinted min-h-[44px]"
              onClick={() => adjust('consume')}
              disabled={saving}
            >
              <Utensils className="w-4 h-4" aria-hidden="true" />
              <span>{copy('usedIt')}</span>
            </button>
            <button
              type="button"
              className="btn-ghost min-h-[44px]"
              onClick={() => adjust('discard')}
              disabled={saving}
            >
              <Trash2 className="w-4 h-4" aria-hidden="true" />
              <span>{copy('throwAway')}</span>
            </button>
            {onRestock && <button type="button" className="btn-plain min-h-[44px]" disabled={locked || suspended} onClick={() => { if (!mutationRef.current) onRestock(); }}>{copy('restock')}</button>}
          </div>
        </div>
      )}

      <form id={titleId} onSubmit={submit} className="space-y-4" noValidate>
        <fieldset disabled={locked} className="space-y-4">
          {mode === 'add' && <FoodDescriptionDraft enabled={!locked && !suspended} contextKey={`${context?.userId ?? ''}:${context?.familyId ?? ''}`} onApply={(draft) => {
            if (locked || suspended || mutationRef.current) return
            setName(draft.name)
            if (draft.amount !== undefined) { setAmount(String(draft.amount)); setUnit(draft.unit ?? '') }
            if (draft.location) setLocation(draft.location)
            if (draft.expires_on && draft.date_kind) { setExpiresOn(draft.expires_on); setDateKind(draft.date_kind) }
            setError(null)
          }} />}
          <div>
            <label htmlFor={`${titleId}-name`} className="text-subhead text-label-secondary mb-1 block">
              {copy('name')}
            </label>
            <input
              id={`${titleId}-name`}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              required
              ref={nameRef}
              className="w-full input-apple"
            />
          </div>

          <fieldset>
            <legend className="text-subhead text-label-secondary mb-1">{copy('where')}</legend>
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
                  {copy(loc)}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor={`${titleId}-amount`} className="text-subhead text-label-secondary mb-1 block">
                {copy('amount')} <span className="text-label-tertiary">{copy('optional')}</span>
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
                {copy('unit')} <span className="text-label-tertiary">{copy('optional')}</span>
              </label>
              <input
                id={`${titleId}-unit`}
                type="text"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                maxLength={32}
                placeholder={copy('unitExample')}
                className="w-full input-apple"
              />
            </div>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-subhead text-label-secondary mb-1">
              {copy('packDate')} <span className="text-label-tertiary">{copy('optional')}</span>
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
                  {copy(kind)}
                </label>
              ))}
            </div>
            <p className="text-footnote text-label-secondary" id={`${titleId}-date-help`}>
              {dateKind === 'use_by' ? copy('useBySafety') : copy('bestBeforeQuality')}
            </p>
            <div className="flex gap-2">
              <label htmlFor={`${titleId}-expires`} className="sr-only">
                {copy('dateLabel', { kind: copy(dateKind) })}
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
                  {copy('clearDate')}
                </button>
              )}
            </div>
          </fieldset>

          <details
            open={showDetails}
            onToggle={(event) => setShowDetails(event.currentTarget.open)}
            className="rounded-xl border border-[var(--surface-separator)] p-3"
          >
            <summary tabIndex={0} className="min-h-11 cursor-pointer py-3 text-subhead font-semibold">
              {copy('moreDetails')}
            </summary>
            <div className="space-y-4 pt-2">
              <div>
                <label htmlFor={`${titleId}-category`} className="text-subhead text-label-secondary mb-1 block">
                  {copy('category')} <span className="text-label-tertiary">{copy('optional')}</span>
                </label>
                <select
                  id={`${titleId}-category`}
                  value={category}
                  onChange={(e) => setCategory(e.target.value as InventoryCategory | '')}
                  className="w-full input-apple min-h-[44px]"
                >
                  <option value="">{copy('noCategory')}</option>
                  {INVENTORY_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {copy(c)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor={`${titleId}-purchased`} className="text-subhead text-label-secondary mb-1 block">
                    {copy('bought')} <span className="text-label-tertiary">{copy('optional')}</span>
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
                    {copy('opened')} <span className="text-label-tertiary">{copy('optional')}</span>
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
            </div>
          </details>
          {error && !showRemove && (
            <p role="alert" className="text-subhead text-[var(--danger-text)]">
              <InventoryText feedback={error} />
            </p>
          )}
        </fieldset>
      </form>
      <Dialog
        open={showRemove && !suspended}
        role="alertdialog"
        title={copy('remove')}
        description={copy('removeConfirm', { name: initial?.name ?? copy('itemFallback') })}
        closeLabel={copy('close')}
        initialFocusRef={keepRef}
        onClose={saving ? undefined : closeRemove}
      >
        {error && (
          <p role="alert" className="mb-4 text-subhead text-[var(--danger-text)]">
            <InventoryText feedback={error} />
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <button ref={keepRef} type="button" className="btn-tinted min-h-11" disabled={saving} onClick={closeRemove}>
            {copy('keepItem')}
          </button>
          <button type="button" className="btn-destructive min-h-11" disabled={saving} onClick={() => void remove()}>
            {copy(saving ? 'saving' : 'remove')}
          </button>
        </div>
      </Dialog>
    </Dialog>
  )
}
