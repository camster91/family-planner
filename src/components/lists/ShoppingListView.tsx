'use client'

import { useState, useMemo, useCallback } from 'react'
import {
  Search,
  Plus,
  Minus,
  Filter,
  Receipt,
  Calendar,
  RotateCcw,
  Link2,
  ShoppingCart,
  CheckCircle2,
  Circle,
  Tag,
  Loader2,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import ListItemRow, { type ListItemData } from './ListItemRow'

interface ListInfo {
  id: string
  name: string
  type: string
  description: string | null
  is_repeatable: boolean
  last_purchased_at: string | null
  created_by: string
}

interface ShoppingListViewProps {
  list: ListInfo
  initialItems: ListItemData[]
  userId: string
  budgetCategories?: { id: string; name: string; icon: string }[]
}

type FilterTab = 'all' | 'to-buy' | 'purchased'

export default function ShoppingListView({
  list,
  initialItems,
  userId,
  budgetCategories = [],
}: ShoppingListViewProps) {
  const [items, setItems] = useState<ListItemData[]>(initialItems)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all')
  const [quickAddText, setQuickAddText] = useState('')
  const [quickAddQty, setQuickAddQty] = useState(1)
  const [addingItem, setAddingItem] = useState(false)
  const [loggingPurchases, setLoggingPurchases] = useState(false)
  const [sendingToCalendar, setSendingToCalendar] = useState(false)
  const [repeatingList, setRepeatingList] = useState(false)
  const [showActions, setShowActions] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3500)
  }

  // API helpers
  const apiCall = useCallback(async (url: string, options?: RequestInit) => {
    const res = await fetch(url, options)
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Request failed')
    return data
  }, [])

  // Toggle item checked
  const handleToggle = useCallback(async (itemId: string, checked: boolean) => {
    // Optimistic update
    setItems((prev) =>
      prev.map((i) =>
        i.id === itemId ? { ...i, checked, checked_at: checked ? new Date().toISOString() : undefined } : i
      )
    )

    try {
      await apiCall('/api/lists/items/update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, checked }),
      })
    } catch (err) {
      // Revert on error
      setItems((prev) =>
        prev.map((i) => (i.id === itemId ? { ...i, checked: !checked } : i))
      )
      showToast('Failed to update item', 'error')
    }
  }, [apiCall])

  // Update item fields
  const handleUpdate = useCallback(async (itemId: string, updates: Partial<Pick<ListItemData, 'content' | 'quantity' | 'price' | 'category' | 'notes'>>) => {
    // Optimistic update
    setItems((prev) =>
      prev.map((i) => (i.id === itemId ? { ...i, ...updates } : i))
    )

    try {
      await apiCall('/api/lists/items/update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, ...updates }),
      })
    } catch (err) {
      showToast('Failed to update item', 'error')
    }
  }, [apiCall])

  // Delete item
  const handleDelete = useCallback(async (itemId: string) => {
    if (!confirm('Delete this item?')) return

    setItems((prev) => prev.filter((i) => i.id !== itemId))

    try {
      await apiCall(`/api/lists/items/delete?itemId=${itemId}`, { method: 'DELETE' })
    } catch (err) {
      showToast('Failed to delete item', 'error')
    }
  }, [apiCall])

  // Toggle purchased
  const handlePurchaseToggle = useCallback(async (itemId: string, purchased: boolean) => {
    setItems((prev) =>
      prev.map((i) => (i.id === itemId ? { ...i, purchased } : i))
    )

    try {
      await apiCall('/api/lists/items/update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, purchased }),
      })
    } catch (err) {
      setItems((prev) =>
        prev.map((i) => (i.id === itemId ? { ...i, purchased: !purchased } : i))
      )
      showToast('Failed to update purchase status', 'error')
    }
  }, [apiCall])

  // Quick add item
  const handleQuickAdd = async () => {
    const trimmed = quickAddText.trim()
    if (!trimmed || addingItem) return

    setAddingItem(true)
    try {
      const data = await apiCall('/api/lists/items/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listId: list.id,
          content: trimmed,
          quantity: quickAddQty,
        }),
      })
      setItems((prev) => [...prev, data.item])
      setQuickAddText('')
      setQuickAddQty(1)
    } catch (err) {
      showToast('Failed to add item', 'error')
    } finally {
      setAddingItem(false)
    }
  }

  // Log purchases as budget expenses
  const handleLogPurchases = async () => {
    const purchasedItems = items.filter((i) => i.purchased && i.price && i.price > 0)
    if (purchasedItems.length === 0) {
      showToast('No purchased items with prices to log', 'error')
      return
    }

    if (!confirm(`Log ${purchasedItems.length} purchased items as expenses in the budget?`)) return

    setLoggingPurchases(true)
    let succeeded = 0
    let failed = 0

    for (const item of purchasedItems) {
      try {
        await apiCall('/api/budget/transactions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: -Math.abs(item.price!),
            type: 'expense',
            description: `🛒 ${item.content} (qty: ${item.quantity})`,
            notes: `Shopping list: ${list.name}`,
            date: new Date().toISOString(),
          }),
        })
        succeeded++
      } catch {
        failed++
      }
    }

    if (failed === 0) {
      showToast(`${succeeded} purchase${succeeded !== 1 ? 's' : ''} logged as expenses`)
    } else {
      showToast(`${succeeded} logged, ${failed} failed`, 'error')
    }
    setLoggingPurchases(false)
  }

  // Send to calendar
  const handleSendToCalendar = async () => {
    const uncheckedItems = items.filter((i) => !i.checked)
    const itemCount = uncheckedItems.length

    if (itemCount === 0) {
      showToast('All items are already checked off. Nothing to shop for!', 'error')
      return
    }

    // Default: schedule for tomorrow 10am-11am
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setHours(10, 0, 0, 0)
    const endTime = new Date(tomorrow)
    endTime.setHours(11, 0, 0, 0)

    const itemSummary = uncheckedItems
      .slice(0, 5)
      .map((i) => `• ${i.content}${i.quantity > 1 ? ` (x${i.quantity})` : ''}`)
      .join('\n')

    const moreText = itemCount > 5 ? `\n...and ${itemCount - 5} more items` : ''

    setSendingToCalendar(true)
    try {
      await apiCall('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `🛒 Shopping: ${list.name}`,
          description: `${itemSummary}${moreText}\n\nFrom list: ${list.name}`,
          start_time: tomorrow.toISOString(),
          end_time: endTime.toISOString(),
          location: '',
          event_type: 'family',
        }),
      })
      showToast('Shopping trip added to calendar')
    } catch (err) {
      showToast('Failed to create calendar event', 'error')
    } finally {
      setSendingToCalendar(false)
    }
  }

  // Repeat list (uncheck all items)
  const handleRepeatList = async () => {
    const checkedItems = items.filter((i) => i.checked)
    if (checkedItems.length === 0) {
      showToast('No checked items to reset', 'error')
      return
    }

    if (!confirm(`Uncheck ${checkedItems.length} completed items for the next trip?`)) return

    setRepeatingList(true)
    let succeeded = 0
    let failed = 0

    for (const item of checkedItems) {
      try {
        await apiCall('/api/lists/items/update', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemId: item.id, checked: false, purchased: false }),
        })
        succeeded++
      } catch {
        failed++
      }
    }

    // Update all items locally
    setItems((prev) =>
      prev.map((i) =>
        i.checked ? { ...i, checked: false, purchased: false, checked_by: undefined, checked_at: undefined } : i
      )
    )

    if (failed === 0) {
      showToast(`List reset — ${succeeded} items unchecked`)
    } else {
      showToast(`${succeeded} reset, ${failed} failed`, 'error')
    }
    setRepeatingList(false)
  }

  // Filter and search
  const filteredItems = useMemo(() => {
    let result = items

    // Apply search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(
        (i) =>
          i.content.toLowerCase().includes(q) ||
          (i.category && i.category.toLowerCase().includes(q)) ||
          (i.notes && i.notes.toLowerCase().includes(q))
      )
    }

    // Apply filter tab
    switch (activeFilter) {
      case 'to-buy':
        result = result.filter((i) => !i.checked)
        break
      case 'purchased':
        result = result.filter((i) => i.purchased)
        break
    }

    return result
  }, [items, searchQuery, activeFilter])

  // Stats
  const totalItems = items.length
  const checkedItems = items.filter((i) => i.checked).length
  const purchasedItems = items.filter((i) => i.purchased).length
  const totalPrice = items.reduce((sum, i) => sum + (i.price || 0) * i.quantity, 0)
  const progressPct = totalItems > 0 ? Math.round((checkedItems / totalItems) * 100) : 0

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toast && (
        <div
          className={cn(
            'fixed top-4 right-4 z-50 px-5 py-3 rounded-xl shadow-lg text-sm font-medium animate-slide-in',
            toast.type === 'success'
              ? 'bg-emerald-600 text-white'
              : 'bg-red-600 text-white'
          )}
        >
          {toast.message}
        </div>
      )}

      {/* Search + Quick Stats Bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search items..."
            className="w-full h-10 pl-10 pr-4 rounded-xl border border-gray-200 bg-white text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-50 rounded-xl px-4 py-2 flex-shrink-0">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
          <span className="font-semibold text-gray-700">{checkedItems}</span>
          <span>/</span>
          <span>{totalItems}</span>
          <span>items</span>
          {totalPrice > 0 && (
            <>
              <span className="mx-1 text-gray-300">|</span>
              <span className="font-semibold text-gray-700">${totalPrice.toFixed(2)}</span>
            </>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      {totalItems > 0 && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-gray-500">
            <span>{progressPct}% complete</span>
            <span>{checkedItems} of {totalItems}</span>
          </div>
          <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-emerald-400 to-emerald-500 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex items-center gap-1 p-1 bg-gray-100 rounded-xl">
        {([
          { key: 'all', label: 'All', icon: Filter },
          { key: 'to-buy', label: 'To Buy', icon: Circle },
          { key: 'purchased', label: 'Purchased', icon: ShoppingCart },
        ] as const).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveFilter(tab.key)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200',
              activeFilter === tab.key
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            )}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Items List */}
      <div className="space-y-1">
        {filteredItems.length > 0 ? (
          filteredItems.map((item) => (
            <ListItemRow
              key={item.id}
              item={item}
              onToggle={handleToggle}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
              onPurchaseToggle={handlePurchaseToggle}
            />
          ))
        ) : (
          <div className="text-center py-16">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Search className="w-7 h-7 text-gray-300" />
            </div>
            <p className="text-gray-500 font-medium">
              {searchQuery
                ? 'No items match your search'
                : activeFilter === 'purchased'
                ? 'No purchased items yet'
                : 'No items in this list yet'}
            </p>
            <p className="text-sm text-gray-400 mt-1">
              {searchQuery ? 'Try a different search term' : 'Add items using the input below'}
            </p>
          </div>
        )}
      </div>

      {/* Quick Add Bar */}
      <div className="flex items-center gap-2 p-3 bg-white border border-gray-200 rounded-xl shadow-sm">
        <Plus className="w-5 h-5 text-gray-400 flex-shrink-0" />
        <input
          type="text"
          value={quickAddText}
          onChange={(e) => setQuickAddText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleQuickAdd()
          }}
          placeholder="Quick-add item..."
          className="flex-1 bg-transparent text-sm text-gray-800 placeholder:text-gray-400 outline-none"
        />
        <div className="flex items-center gap-1 bg-gray-50 rounded-lg border border-gray-200">
          <button
            type="button"
            onClick={() => setQuickAddQty(Math.max(1, quickAddQty - 1))}
            className="w-7 h-7 flex items-center justify-center text-gray-500 hover:text-gray-700"
          >
            <Minus className="w-3 h-3" />
          </button>
          <span className="w-6 text-center text-xs font-semibold text-gray-600 tabular-nums">
            {quickAddQty}
          </span>
          <button
            type="button"
            onClick={() => setQuickAddQty(quickAddQty + 1)}
            className="w-7 h-7 flex items-center justify-center text-gray-500 hover:text-gray-700"
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>
        <button
          onClick={handleQuickAdd}
          disabled={!quickAddText.trim() || addingItem}
          className="px-4 py-2 bg-blue-500 text-white text-sm font-medium rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
        >
          {addingItem ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            'Add'
          )}
        </button>
      </div>

      {/* Action Buttons */}
      <div className="border-t pt-4">
        <button
          onClick={() => setShowActions(!showActions)}
          className="flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
        >
          <Tag className="w-4 h-4" />
          List Actions
          <span className={cn('transition-transform', showActions && 'rotate-180')}>▾</span>
        </button>

        {showActions && (
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Log Purchases */}
            <button
              onClick={handleLogPurchases}
              disabled={loggingPurchases || purchasedItems === 0}
              className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-purple-50 text-purple-700 text-sm font-medium hover:bg-purple-100 disabled:opacity-40 disabled:cursor-not-allowed transition-all border border-purple-200"
            >
              {loggingPurchases ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Receipt className="w-4 h-4" />
              )}
              Log as expenses
            </button>

            {/* Send to Calendar */}
            <button
              onClick={handleSendToCalendar}
              disabled={sendingToCalendar}
              className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-orange-50 text-orange-700 text-sm font-medium hover:bg-orange-100 disabled:opacity-40 disabled:cursor-not-allowed transition-all border border-orange-200"
            >
              {sendingToCalendar ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Calendar className="w-4 h-4" />
              )}
              Send to calendar
            </button>

            {/* Repeat List */}
            <button
              onClick={handleRepeatList}
              disabled={repeatingList || checkedItems === 0}
              className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-teal-50 text-teal-700 text-sm font-medium hover:bg-teal-100 disabled:opacity-40 disabled:cursor-not-allowed transition-all border border-teal-200"
            >
              {repeatingList ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RotateCcw className="w-4 h-4" />
              )}
              Repeat list
            </button>
          </div>
        )}
      </div>

      {/* Share / Privacy indicator (future placeholder) */}
      <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
        <Link2 className="w-4 h-4 text-gray-300" />
        <span className="text-xs text-gray-400">Family list — shared with everyone</span>
      </div>
    </div>
  )
}


