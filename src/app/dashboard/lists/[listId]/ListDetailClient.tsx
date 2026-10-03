'use client'

import * as React from 'react'
import { Plus, CheckSquare, CloudOff, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CheckboxRow } from '@/components/ui/checkbox-row'
import { SwipeRow } from '@/components/ui/swipe-row'
import { Glyph } from '@/components/ui/glyph'
import { ProgressRing } from '@/components/ui/progress-ring'
import { InsetList, SectionHeader } from '@/components/ui/list-row'
import { EmptyState } from '@/components/ui/empty-state'
import { ILLUSTRATIONS } from '@/lib/brand-illustrations'
import type { ListType } from '@/types'
import type { QueuedOperation } from '@/lib/offline-queue'
import { useListItemSync, type SyncNotice } from './use-list-item-sync'
import { buildGrocerySections, groceryDetailText, isGroceryListType, storeSectionOf } from '@/lib/grocery-display'
import {
  GROCERY_SECTIONS,
  grocerySectionLabel,
  isGrocerySection,
  sectionNameKey,
  type GrocerySectionId,
} from '@/lib/grocery-sections'
import { MoveToSectionDialog, type MoveTarget } from './MoveToSectionDialog'
import { useToast, useUndoToast } from '@/components/ui/toast'

// -----------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------

interface Item {
  id: string
  content: string
  checked: boolean
  quantity: number
  category: string | null
  added_by: { name: string }
  checked_by?: { name: string }
  checked_at?: string
  // Grocery fields (ADR-0007, #252); null on generic lists.
  amount?: number | null
  unit?: string | null
  ingredient_id?: string | null
  ingredient_name?: string | null
  recipe_title?: string | null
  /** Resolved store section (#273); grocery/shopping lists only. */
  section?: string | null
}

/** Store-section sorting for grocery/shopping lists (#273), delivered with the page. */
export interface SectionSortProps {
  /** `List.sort_by_section`. */
  enabled: boolean
  /** Section ids in display order (learned walking order or the fixed order). */
  order: GrocerySectionId[]
  /** True when `order` was learned from the household's shopping trips. */
  learned: boolean
  /** Household overrides for the names on this list: `{ name_key: section }`. */
  overrides: Record<string, GrocerySectionId>
  /** Parent and teen may switch sorting on or off. */
  canChange: boolean
}

const DEFAULT_SECTION_SORT: SectionSortProps = {
  enabled: true,
  order: [...GROCERY_SECTIONS],
  learned: false,
  overrides: {},
  canChange: false,
}

/** A row returned by POST /api/lists/items/create, shaped like the page's items. */
function toItem(raw: Record<string, unknown>): Item {
  return {
    id: String(raw.id),
    content: String(raw.content ?? ''),
    checked: raw.checked === true,
    quantity: typeof raw.quantity === 'number' ? raw.quantity : 1,
    category: typeof raw.category === 'string' ? raw.category : null,
    added_by: { name: 'You' },
    amount: typeof raw.amount === 'number' ? raw.amount : null,
    unit: typeof raw.unit === 'string' ? raw.unit : null,
    ingredient_id: typeof raw.ingredient_id === 'string' ? raw.ingredient_id : null,
    ingredient_name: null,
    recipe_title: null,
    section: typeof raw.section === 'string' ? raw.section : null,
  }
}

interface ListDetailClientProps {
  listId: string
  listName: string
  listType: ListType
  items: Item[]
  userId: string
  /** D9 (#102): deleting an item is parent-only. */
  canDeleteItems?: boolean
  /** Store sections (#273); only used on grocery/shopping lists. */
  sectionSort?: SectionSortProps
}

// -----------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------

export default function ListDetailClient({
  listId,
  listName,
  listType,
  items: initialItems,
  userId,
  canDeleteItems = true,
  sectionSort = DEFAULT_SECTION_SORT,
}: ListDetailClientProps) {
  const [listItems, setListItems] = React.useState<Item[]>(initialItems)
  const [newItemText, setNewItemText] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  // Why the last "Add" failed; the typed text stays in the field.
  const [addError, setAddError] = React.useState<string | null>(null)
  const [recentlySynced, setRecentlySynced] = React.useState<Set<string>>(() => new Set())
  const { addToast } = useToast()
  const showUndo = useUndoToast()

  // Store sections (#273). Grouping is computed here from row data and the
  // overrides delivered with the page, so it needs no request (offline ticks).
  const isGrocery = isGroceryListType(listType)
  const [sortBySection, setSortBySection] = React.useState(sectionSort.enabled)
  const [sortPending, setSortPending] = React.useState(false)
  const [sortError, setSortError] = React.useState<string | null>(null)
  const [overrides, setOverrides] = React.useState<Record<string, GrocerySectionId>>(sectionSort.overrides)
  const [moveTarget, setMoveTarget] = React.useState<MoveTarget | null>(null)
  const [movePending, setMovePending] = React.useState(false)
  const [moveError, setMoveError] = React.useState<string | null>(null)
  const storeSort = isGrocery && sortBySection

  // Tick/untick goes through the offline queue (#162, OFFLINE_SYNC.md): the
  // item shows the queued state with a visible sync status until the server
  // confirms it; the server state changes only on confirmation.
  const sync = useListItemSync(userId, (itemId, checked, body) => {
    const serverItem = (body as { item?: { checked?: unknown; checked_at?: unknown } } | null)?.item
    const confirmed = typeof serverItem?.checked === 'boolean' ? serverItem.checked : checked
    setListItems(prev => prev.map(i => i.id === itemId
      ? {
          ...i,
          checked: confirmed,
          checked_at: confirmed && typeof serverItem?.checked_at === 'string' ? serverItem.checked_at : undefined,
          checked_by: confirmed ? i.checked_by : undefined,
        }
      : i))
    setRecentlySynced(prev => new Set(prev).add(itemId))
    window.setTimeout(() => {
      setRecentlySynced(prev => {
        const next = new Set(prev)
        next.delete(itemId)
        return next
      })
    }, 3000)
  })

  const displayChecked = (item: Item) => sync.stateFor(item.id)?.payload.checked ?? item.checked

  // Progress
  const total = listItems.length
  const done = listItems.filter(displayChecked).length
  const progress = total > 0 ? done / total : 0

  // Sections by store section in the household's order (#273), or by category
  // when sorting is off or the list is not a grocery list. Open rows for the
  // same ingredient are shown together within a section (ADR-0007 O-3).
  // Checked rows stay in their section at their list position.
  const sectionOf = (item: Item) => storeSectionOf(item, overrides)
  const sections = storeSort
    ? buildGrocerySections(listItems, displayChecked, {
        sectionOf,
        order: sectionSort.order,
        label: (key) => (isGrocerySection(key) ? grocerySectionLabel(key) : key),
      })
    : buildGrocerySections(listItems, displayChecked)

  const handleSortChange = async (next: boolean) => {
    if (sortPending) return
    setSortPending(true)
    setSortError(null)
    setSortBySection(next)
    try {
      const res = await fetch('/api/lists/section-sort', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listId, sortBySection: next }),
      })
      if (!res.ok) throw new Error(String(res.status))
    } catch {
      setSortBySection(!next)
      setSortError('Couldn’t change the sorting. Check your connection and try again.')
    } finally {
      setSortPending(false)
    }
  }

  const openMove = (item: Item) => {
    const key = sectionNameKey(item.content)
    setMoveError(null)
    setMoveTarget({ itemId: item.id, content: item.content, current: sectionOf(item), chosen: key in overrides })
  }

  const handleMove = async (section: GrocerySectionId | null) => {
    if (!moveTarget || movePending) return
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setMoveError('You’re offline. Moving an item needs a connection.')
      return
    }
    setMovePending(true)
    setMoveError(null)
    try {
      const res = await fetch('/api/lists/items/section', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: moveTarget.itemId, section }),
      })
      const body = (await res.json().catch(() => null)) as {
        nameKey?: string
        override?: string | null
        sections?: Record<string, string>
      } | null
      if (!res.ok || !body?.nameKey) throw new Error(String(res.status))
      const moved = body.sections ?? {}
      setListItems((prev) => prev.map((i) => (typeof moved[i.id] === 'string' ? { ...i, section: moved[i.id] } : i)))
      setOverrides((prev) => {
        const next = { ...prev }
        if (isGrocerySection(body.override)) next[body.nameKey!] = body.override
        else delete next[body.nameKey!]
        return next
      })
      setMoveTarget(null)
    } catch {
      setMoveError('Couldn’t move this item. Try again.')
    } finally {
      setMovePending(false)
    }
  }

  const handleToggle = (itemId: string, checked: boolean) => {
    setRecentlySynced(prev => {
      if (!prev.has(itemId)) return prev
      const next = new Set(prev)
      next.delete(itemId)
      return next
    })
    void sync.setChecked(itemId, checked)
  }

  // Undo over confirm (#269): the item goes at once and Undo puts it back by
  // re-creating it (same text, quantity, category, amount, unit and
  // ingredient; ticked again if it was ticked). The restored row is a new row
  // at the end of the list and no longer shows which recipe added it.
  // `wasChecked` is what the person saw when deleting, including a tick still
  // queued offline (#162), not the possibly stale server value.
  const restoreItem = async (item: Item, wasChecked: boolean) => {
    try {
      const res = await fetch('/api/lists/items/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listId,
          content: item.content,
          quantity: item.quantity || 1,
          ...(item.category ? { category: item.category } : {}),
          ...(typeof item.amount === 'number' ? { amount: item.amount } : {}),
          ...(item.unit ? { unit: item.unit } : {}),
          ...(item.ingredient_id ? { ingredient_id: item.ingredient_id } : {}),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.item) throw new Error(typeof data.error === 'string' ? data.error : 'Please try again.')
      const restored: Item = { ...toItem(data.item), ingredient_name: item.ingredient_name ?? null, added_by: item.added_by }
      setListItems(prev => [...prev, restored])
      if (wasChecked) void sync.setChecked(restored.id, true)
    } catch (err) {
      addToast({
        type: 'error',
        title: `Couldn't put back “${item.content}”`,
        message: err instanceof Error ? err.message : 'Please try again.',
      })
    }
  }

  const handleDeleteItem = async (itemId: string) => {
    const item = listItems.find(i => i.id === itemId)
    if (!item) return
    const wasChecked = displayChecked(item)
    const queued = sync.stateFor(itemId)
    setListItems(prev => prev.filter(i => i.id !== itemId))
    let ok = false
    try {
      const res = await fetch(`/api/lists/items/${encodeURIComponent(itemId)}`, { method: 'DELETE' })
      ok = res.ok
    } catch {
      ok = false
    }
    if (!ok) {
      setListItems(prev => (prev.some(i => i.id === itemId) ? prev : [...prev, item]))
      addToast({ type: 'error', title: `Couldn't delete “${item.content}”`, message: 'Check your connection and try again.' })
      return
    }
    // A tick still queued for the deleted row can never apply; drop it so it
    // does not linger as a failed change. Undo re-applies it to the new row.
    if (queued) void sync.discard(queued.id)
    showUndo({ title: `Deleted “${item.content}”`, onUndo: () => void restoreItem(item, wasChecked) })
  }

  const handleAdd = async () => {
    const trimmed = newItemText.trim()
    if (!trimmed || loading) return
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setAddError(`You're offline. “${trimmed}” wasn't added. Try again when you're back online.`)
      return
    }
    setLoading(true)
    setAddError(null)
    try {
      let res: Response
      try {
        res = await fetch('/api/lists/items/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ listId, content: trimmed }),
        })
      } catch {
        const offline = typeof navigator !== 'undefined' && navigator.onLine === false
        setAddError(
          offline
            ? `You're offline. “${trimmed}” wasn't added. Try again when you're back online.`
            : `Couldn't add “${trimmed}”. Check your connection and try again.`
        )
        return
      }
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.item) {
        const reason = typeof data?.error === 'string' && data.error ? data.error : 'Please try again.'
        setAddError(`Couldn't add “${trimmed}”. ${reason}`)
        return
      }
      setListItems(prev => [...prev, toItem(data.item)])
      setNewItemText('')
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleAdd()
  }

  const renderRow = (item: Item, isLast: boolean) => {
    const op = sync.stateFor(item.id)
    const checked = displayChecked(item)
    const syncState = op?.state ?? (recentlySynced.has(item.id) ? 'synced' : undefined)
    const status = syncStatusText(op, recentlySynced.has(item.id))
    const detail = groceryDetailText(item)
    const checkedBy = checked && item.checked_by ? `✓ ${item.checked_by.name}` : undefined
    const subtitle = status ?? ([detail, checkedBy].filter(Boolean).join(' · ') || undefined)
    return (
      <SwipeRow
        key={item.id}
        onSwipeLeft={canDeleteItems ? () => handleDeleteItem(item.id) : undefined}
      >
        <div
          data-item-id={item.id}
          data-sync-state={syncState}
          data-section={storeSort ? sectionOf(item) : undefined}
          data-testid="list-item"
        >
          <div className="flex items-stretch">
            <div className="min-w-0 flex-1">
              <CheckboxRow
                checked={checked}
                onChange={() => handleToggle(item.id, !checked)}
                title={item.content}
                subtitle={subtitle}
                wrap
                className={cn(isLast && !needsAction(op) && 'border-b-0')}
              />
            </div>
            {storeSort && !checked && (
              <button
                type="button"
                onClick={() => openMove(item)}
                aria-label={`Move ${item.content} to another section`}
                aria-haspopup="dialog"
                data-testid="move-section"
                className="min-h-[44px] min-w-[44px] shrink-0 self-center px-3 text-subhead text-[var(--accent-text)] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-text)]"
              >
                Move
              </button>
            )}
          </div>
          {op && needsAction(op) && (
            <div
              role="group"
              aria-label={`Sync options for ${item.content}`}
              className={cn('flex flex-wrap gap-2 px-4 pb-3', isLast && 'border-b-0')}
            >
              <button
                type="button"
                onClick={() => void sync.retry(op.id)}
                className="btn-tinted min-h-[44px] px-4"
                aria-label={`Retry syncing ${item.content}`}
              >
                Retry
              </button>
              <button
                type="button"
                onClick={() => void sync.discard(op.id)}
                className="min-h-[44px] px-4 text-subhead text-label-secondary underline-offset-2 hover:underline"
                aria-label={`Discard change to ${item.content}`}
              >
                Discard
              </button>
            </div>
          )}
        </div>
      </SwipeRow>
    )
  }

  return (
    <div className="space-y-5 px-4 pb-20">
      {/* Progress header */}
      <div className="flex items-center gap-4 card-apple p-4">
        <ProgressRing
          progress={progress}
          size={56}
          strokeWidth={5}
        >
          <span className="text-body font-semibold text-label-primary leading-none">{done}</span>
        </ProgressRing>
        <div className="flex-1 min-w-0">
          <p className="text-body text-label-primary font-medium truncate">{listName}</p>
          <p className="text-footnote text-label-secondary mt-0.5">
            {total > 0 ? `${done} of ${total} done` : 'No items yet'}
          </p>
        </div>
        <Glyph color="lists" size="md">
          <CheckSquare className="w-5 h-5 text-white" />
        </Glyph>
      </div>

      <SyncBanner
        online={sync.online}
        durable={sync.durable}
        pendingCount={sync.pendingCount}
        notice={sync.notice}
        onDismiss={sync.dismissNotice}
      />

      {isGrocery && (
        <SectionSortControl
          enabled={sortBySection}
          learned={sectionSort.learned}
          canChange={sectionSort.canChange}
          pending={sortPending}
          error={sortError}
          onChange={handleSortChange}
        />
      )}

      {/* Items grouped by store section or category, then by ingredient */}
      {total > 0 ? (
        sections.map((section) => (
          <section
            key={section.key}
            aria-label={storeSort ? section.category : undefined}
            data-testid={storeSort ? 'store-section' : undefined}
            data-section={storeSort ? section.key : undefined}
          >
            <SectionHeader>{section.category}</SectionHeader>
            <InsetList>
              {section.entries.map((entry, i) => {
                const isLastEntry = i === section.entries.length - 1
                if (entry.kind === 'item') return renderRow(entry.item, isLastEntry)
                return (
                  <div
                    key={`ingredient-${entry.ingredientId}`}
                    role="group"
                    aria-label={`${entry.name}, ${entry.items.length} entries`}
                    data-testid="ingredient-group"
                  >
                    <p className="px-4 pt-2.5 pb-1 text-footnote font-semibold text-label-secondary break-words">
                      {entry.name} · {entry.items.length} entries
                    </p>
                    {entry.items.map((item, j) => renderRow(item, isLastEntry && j === entry.items.length - 1))}
                  </div>
                )
              })}
            </InsetList>
          </section>
        ))
      ) : (
        <EmptyState
          icon={CheckSquare}
          glyphColor="lists"
          illustration={isGrocery ? ILLUSTRATIONS.groceriesClear : ILLUSTRATIONS.listsEmpty}
          title="No items yet"
          description="Add items using the field below."
        />
      )}

      <MoveToSectionDialog
        target={moveTarget}
        pending={movePending}
        error={moveError}
        onPick={(section) => void handleMove(section)}
        onClose={() => setMoveTarget(null)}
      />

      {/* Add item field */}
      <div className="card-apple px-4 py-3">
        <div className="flex items-center gap-3">
          <Plus className="w-5 h-5 text-label-tertiary shrink-0" />
          <input
            type="text"
            value={newItemText}
            onChange={(e) => setNewItemText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add an item…"
            aria-label="Add an item"
            aria-invalid={addError ? true : undefined}
            aria-describedby={addError ? 'list-add-error' : undefined}
            disabled={loading}
            className="flex-1 bg-transparent text-body text-label-primary placeholder:text-label-tertiary outline-none"
          />
          {newItemText.trim() && (
            <button
              onClick={handleAdd}
              disabled={loading}
              className="text-[var(--accent)] text-subhead font-medium active:scale-95 transition-transform disabled:opacity-50"
            >
              Add
            </button>
          )}
        </div>
        {addError && (
          <p id="list-add-error" role="alert" className="pt-2 text-footnote text-[var(--danger-text)]">
            {addError}
          </p>
        )}
      </div>
    </div>
  )
}

// -----------------------------------------------------------------------
// Store-section sorting switch (#273). The state is written out ("On"/"Off"),
// not shown by colour only; a child sees the current state without a switch.
// -----------------------------------------------------------------------

function SectionSortControl({
  enabled,
  learned,
  canChange,
  pending,
  error,
  onChange,
}: {
  enabled: boolean
  learned: boolean
  canChange: boolean
  pending: boolean
  error: string | null
  onChange: (next: boolean) => void
}) {
  const hint = enabled
    ? learned
      ? 'Sections follow the order your household usually shops.'
      : 'Items are grouped by store section.'
    : 'Items stay in the order they were added.'
  return (
    <div className="card-apple px-4 py-2" data-testid="section-sort">
      {canChange ? (
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          disabled={pending}
          onClick={() => onChange(!enabled)}
          className="flex min-h-[44px] w-full items-center justify-between gap-3 text-left disabled:opacity-60 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-text)]"
        >
          <span className="text-body text-label-primary">Sort by store section</span>
          <span className="inline-flex shrink-0 items-center gap-2">
            <span className="text-subhead text-label-secondary" aria-hidden="true">
              {enabled ? 'On' : 'Off'}
            </span>
            <span
              aria-hidden="true"
              className={cn(
                'relative inline-flex h-[31px] w-[51px] rounded-full transition-colors',
                enabled ? 'bg-[var(--success)]' : 'bg-[var(--surface-fill-secondary)]'
              )}
            >
              <span
                className={cn(
                  'absolute top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow-[var(--shadow-sm)] motion-safe:transition-transform',
                  enabled ? 'translate-x-[22px]' : 'translate-x-[2px]'
                )}
              />
            </span>
          </span>
        </button>
      ) : (
        <p className="flex min-h-[44px] items-center text-body text-label-primary">
          Sort by store section: {enabled ? 'On' : 'Off'}
        </p>
      )}
      <p className="pb-1 text-footnote text-label-secondary">{hint}</p>
      {error && (
        <p role="alert" className="pb-1 text-footnote text-label-primary">
          {error}
        </p>
      )}
    </div>
  )
}

// -----------------------------------------------------------------------
// Sync status (#162). Text, not colour only; failed and conflict stay
// visible until the person retries or discards. Exported for the design
// gallery (/dev/design-system, #156), which renders these states from fixtures.
// -----------------------------------------------------------------------

function needsAction(op: QueuedOperation | undefined): boolean {
  return op?.state === 'failed' || op?.state === 'conflict'
}

export function syncStatusText(op: QueuedOperation | undefined, recentlySynced: boolean): string | undefined {
  if (!op) return recentlySynced ? 'Synced' : undefined
  switch (op.state) {
    case 'pending':
      return 'Waiting to sync'
    case 'syncing':
      return 'Syncing…'
    case 'failed':
      if (op.lastError === 'EXPIRED') return 'Not synced: this change is too old'
      if (op.lastError === 'FORBIDDEN') return 'Not synced: you can no longer change this item'
      return 'Couldn’t sync this change'
    case 'conflict':
      return op.lastError === 'NOT_FOUND' ? 'Not synced: this item was removed' : 'Not synced: changed elsewhere'
    default:
      return undefined
  }
}

export function SyncBanner({
  online,
  durable,
  pendingCount,
  notice,
  onDismiss,
}: {
  online: boolean
  durable: boolean
  pendingCount: number
  notice: SyncNotice
  onDismiss: () => void
}) {
  const noticeText: Record<Exclude<SyncNotice, null>, string> = {
    'queue-full': 'Too many changes are waiting to sync. Reconnect, then try again.',
    'signed-out': 'You were signed out, so changes made offline were not saved.',
    dropped: 'Some changes saved on this device could not be kept.',
  }
  return (
    <div role="status" aria-live="polite" className="space-y-2 empty:hidden">
      {!online && (
        <div className="card-apple flex items-start gap-3 p-4" data-testid="offline-banner">
          <CloudOff className="w-5 h-5 text-label-secondary shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-subhead text-label-primary">
            {durable
              ? 'You’re offline. Ticks are saved on this device and sync when you reconnect.'
              : 'You’re offline. Ticks sync when you reconnect.'}
            {pendingCount > 0 && ` ${pendingCount} waiting.`}
          </p>
        </div>
      )}
      {!durable && pendingCount > 0 && (
        <div className="card-apple flex items-start gap-3 p-4" data-testid="not-durable-banner">
          <AlertTriangle className="w-5 h-5 text-label-secondary shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-subhead text-label-primary">
            Couldn’t save changes on this device. Keep this page open until they sync, or they will be lost.
          </p>
        </div>
      )}
      {notice && (
        <div className="card-apple flex items-start justify-between gap-3 p-4">
          <p className="text-subhead text-label-primary">{noticeText[notice]}</p>
          <button type="button" onClick={onDismiss} className="min-h-[44px] px-3 text-subhead text-[var(--accent)]">
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}
