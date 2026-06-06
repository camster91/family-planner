'use client'

import * as React from 'react'
import { Plus, CheckSquare } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CheckboxRow } from '@/components/ui/checkbox-row'
import { SwipeRow } from '@/components/ui/swipe-row'
import { Glyph } from '@/components/ui/glyph'
import { ProgressRing } from '@/components/ui/progress-ring'
import { InsetList, SectionHeader } from '@/components/ui/list-row'
import { EmptyState } from '@/components/ui/empty-state'
import type { ListType } from '@/types'

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
}: ListDetailClientProps) {
  const [listItems, setListItems] = React.useState<Item[]>(initialItems)
  const [newItemText, setNewItemText] = React.useState('')
  const [loading, setLoading] = React.useState(false)

  // Progress
  const total = listItems.length
  const done = listItems.filter(i => i.checked).length
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

  const handleToggle = async (itemId: string, checked: boolean) => {
    setListItems(prev => prev.map(i => i.id === itemId ? { ...i, checked, checked_at: checked ? new Date().toISOString() : undefined } : i))
    try {
      await fetch('/api/lists/items/update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, checked }),
      })
    } catch {
      setListItems(prev => prev.map(i => i.id === itemId ? { ...i, checked: !checked } : i))
    }
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

      {/* Items grouped by category */}
      {total > 0 ? (
        sortedCategories.map((category) => (
          <section key={category}>
            <SectionHeader>{category}</SectionHeader>
            <InsetList>
              {grouped[category].map((item, i) => (
                <SwipeRow
                  key={item.id}
                  onSwipeLeft={() => handleDeleteItem(item.id)}
                >
                  <CheckboxRow
                    checked={item.checked}
                    onChange={() => handleToggle(item.id, !item.checked)}
                    title={item.content}
                    subtitle={item.checked && item.checked_by ? `✓ ${item.checked_by.name}` : undefined}
                    className={cn(i === grouped[category].length - 1 && 'border-b-0')}
                  />
                </SwipeRow>
              ))}
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