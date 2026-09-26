'use client'

import * as React from 'react'
import { Plus, CheckSquare, CloudOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CheckboxRow } from '@/components/ui/checkbox-row'
import { SwipeRow } from '@/components/ui/swipe-row'
import { Glyph } from '@/components/ui/glyph'
import { ProgressRing } from '@/components/ui/progress-ring'
import { InsetList, SectionHeader } from '@/components/ui/list-row'
import { EmptyState } from '@/components/ui/empty-state'
import type { ListType } from '@/types'
import type { QueuedOperation } from '@/lib/offline-queue'
import { useListItemSync, type SyncNotice } from './use-list-item-sync'

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
}

interface ListDetailClientProps {
  listId: string
  listName: string
  listType: ListType
  items: Item[]
  userId: string
  /** D9 (#102): deleting an item is parent-only. */
  canDeleteItems?: boolean
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
}: ListDetailClientProps) {
  const [listItems, setListItems] = React.useState<Item[]>(initialItems)
  const [newItemText, setNewItemText] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [recentlySynced, setRecentlySynced] = React.useState<Set<string>>(() => new Set())

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

  // Group by category
  const grouped = React.useMemo(() => {
    const groups: Record<string, Item[]> = {}
    for (const item of listItems) {
      const cat = item.category || 'Other'
      if (!groups[cat]) groups[cat] = []
      groups[cat].push(item)
    }
    return groups
  }, [listItems])

  const handleToggle = (itemId: string, checked: boolean) => {
    setRecentlySynced(prev => {
      if (!prev.has(itemId)) return prev
      const next = new Set(prev)
      next.delete(itemId)
      return next
    })
    void sync.setChecked(itemId, checked)
  }

  const handleDeleteItem = async (itemId: string) => {
    if (!confirm('Delete this item?')) return
    try {
      await fetch(`/api/lists/items/delete?itemId=${itemId}`, { method: 'DELETE' })
      setListItems(prev => prev.filter(i => i.id !== itemId))
    } catch (err) {
      console.error('Failed to delete item:', err)
    }
  }

  const handleAdd = async () => {
    const trimmed = newItemText.trim()
    if (!trimmed || loading) return
    setLoading(true)
    try {
      const res = await fetch('/api/lists/items/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listId, content: trimmed }),
      })
      const data = await res.json()
      if (res.ok) {
        setListItems(prev => [...prev, data.item])
        setNewItemText('')
      }
    } catch (err) {
      console.error('Failed to add item:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleAdd()
  }

  const sortedCategories = Object.keys(grouped).sort()

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

      <SyncBanner online={sync.online} pendingCount={sync.pendingCount} notice={sync.notice} onDismiss={sync.dismissNotice} />

      {/* Items grouped by category */}
      {total > 0 ? (
        sortedCategories.map((category) => (
          <section key={category}>
            <SectionHeader>{category}</SectionHeader>
            <InsetList>
              {grouped[category].map((item, i) => {
                const op = sync.stateFor(item.id)
                const checked = displayChecked(item)
                const syncState = op?.state ?? (recentlySynced.has(item.id) ? 'synced' : undefined)
                const status = syncStatusText(op, recentlySynced.has(item.id))
                const isLast = i === grouped[category].length - 1
                return (
                  <SwipeRow
                    key={item.id}
                    onSwipeLeft={canDeleteItems ? () => handleDeleteItem(item.id) : undefined}
                  >
                    <div data-item-id={item.id} data-sync-state={syncState}>
                      <CheckboxRow
                        checked={checked}
                        onChange={() => handleToggle(item.id, !checked)}
                        title={item.content}
                        subtitle={status ?? (checked && item.checked_by ? `✓ ${item.checked_by.name}` : undefined)}
                        className={cn(isLast && !needsAction(op) && 'border-b-0')}
                      />
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
              })}
            </InsetList>
          </section>
        ))
      ) : (
        <EmptyState
          icon={CheckSquare}
          glyphColor="lists"
          title="No items yet"
          description="Add items using the field below."
        />
      )}

      {/* Add item field */}
      <div className="flex items-center gap-3 card-apple px-4 py-3">
        <Plus className="w-5 h-5 text-label-tertiary shrink-0" />
        <input
          type="text"
          value={newItemText}
          onChange={(e) => setNewItemText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add an item…"
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
    </div>
  )
}

// -----------------------------------------------------------------------
// Sync status (#162). Text, not colour only; failed and conflict stay
// visible until the person retries or discards.
// -----------------------------------------------------------------------

function needsAction(op: QueuedOperation | undefined): boolean {
  return op?.state === 'failed' || op?.state === 'conflict'
}

function syncStatusText(op: QueuedOperation | undefined, recentlySynced: boolean): string | undefined {
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

function SyncBanner({
  online,
  pendingCount,
  notice,
  onDismiss,
}: {
  online: boolean
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
            You’re offline. Ticks are saved on this device and sync when you reconnect.
            {pendingCount > 0 && ` ${pendingCount} waiting.`}
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
