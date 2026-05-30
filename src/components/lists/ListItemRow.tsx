'use client'

import { useState, useRef, useEffect } from 'react'
import { Check, Minus, Plus, Trash2, GripVertical, ShoppingBag } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ListItemData {
  id: string
  content: string
  checked: boolean
  quantity: number
  price: number | null
  purchased: boolean
  category: string | null
  notes: string | null
  added_by?: { name: string; avatar_url?: string }
  checked_by?: { name: string }
  checked_at?: string
}

interface ListItemRowProps {
  item: ListItemData
  onToggle: (itemId: string, checked: boolean) => void
  onUpdate: (itemId: string, updates: Partial<Pick<ListItemData, 'content' | 'quantity' | 'price' | 'category' | 'notes'>>) => void
  onDelete: (itemId: string) => void
  onPurchaseToggle: (itemId: string, purchased: boolean) => void
}

export default function ListItemRow({
  item,
  onToggle,
  onUpdate,
  onDelete,
  onPurchaseToggle,
}: ListItemRowProps) {
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(item.content)
  const [showDelete, setShowDelete] = useState(false)
  const [checkAnimating, setCheckAnimating] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  const handleCheck = () => {
    setCheckAnimating(true)
    setTimeout(() => setCheckAnimating(false), 400)
    onToggle(item.id, !item.checked)
  }

  const handleDoubleClick = () => {
    setEditValue(item.content)
    setEditing(true)
  }

  const handleSaveEdit = () => {
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== item.content) {
      onUpdate(item.id, { content: trimmed })
    }
    setEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveEdit()
    } else if (e.key === 'Escape') {
      setEditValue(item.content)
      setEditing(false)
    }
  }

  const handleQuantityChange = (delta: number) => {
    const newQty = Math.max(1, item.quantity + delta)
    if (newQty !== item.quantity) {
      onUpdate(item.id, { quantity: newQty })
    }
  }

  const handlePriceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    // Allow empty string for clearing, or valid decimal
    if (value === '' || value === '0') {
      onUpdate(item.id, { price: null })
      return
    }
    const num = parseFloat(value)
    if (!isNaN(num) && num >= 0) {
      onUpdate(item.id, { price: Math.round(num * 100) / 100 })
    }
  }

  const formatPrice = (price: number | null) => {
    if (price === null || price === undefined) return ''
    return price.toFixed(2)
  }

  return (
    <div
      className={cn(
        'group flex items-center gap-3 px-4 py-3 rounded-xl border transition-all duration-200',
        item.checked
          ? 'bg-emerald-50/60 border-emerald-200/60'
          : 'bg-white border-gray-100 hover:border-gray-200 hover:shadow-sm',
        item.purchased && 'ring-1 ring-purple-200'
      )}
      onMouseEnter={() => setShowDelete(true)}
      onMouseLeave={() => setShowDelete(false)}
    >
      {/* Drag handle (visual only, future) */}
      <div className="opacity-0 group-hover:opacity-30 transition-opacity cursor-grab active:cursor-grabbing flex-shrink-0">
        <GripVertical className="w-4 h-4 text-gray-400" />
      </div>

      {/* Animated Checkbox */}
      <button
        onClick={handleCheck}
        className={cn(
          'flex-shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all duration-200',
          item.checked
            ? 'bg-emerald-500 border-emerald-500 scale-100'
            : 'border-gray-300 hover:border-emerald-400 hover:bg-emerald-50',
          checkAnimating && 'animate-celebrate'
        )}
        aria-label={item.checked ? 'Mark as incomplete' : 'Mark as complete'}
      >
        {item.checked && (
          <Check
            className="w-3.5 h-3.5 text-white"
            strokeWidth={3}
          />
        )}
      </button>

      {/* Item Content */}
      <div className="flex-1 min-w-0">
        {editing ? (
          <input
            ref={inputRef}
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleSaveEdit}
            onKeyDown={handleKeyDown}
            className="w-full bg-transparent border-b-2 border-blue-400 px-1 py-0.5 text-sm font-medium text-gray-900 outline-none"
          />
        ) : (
          <div
            className={cn(
              'text-sm font-medium cursor-default select-none',
              item.checked
                ? 'line-through text-gray-400'
                : 'text-gray-800'
            )}
            onDoubleClick={handleDoubleClick}
            title="Double-click to edit"
          >
            {item.content}
          </div>
        )}

        {/* Meta row: category, notes preview */}
        <div className="flex flex-wrap items-center gap-2 mt-1">
          {item.category && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
              {item.category}
            </span>
          )}
          {item.quantity > 1 && !editing && (
            <span className="text-xs text-gray-400">qty: {item.quantity}</span>
          )}
          {item.checked && item.checked_by && (
            <span className="text-xs text-emerald-600">
              ✓ {item.checked_by.name}
            </span>
          )}
        </div>
      </div>

      {/* Quantity Stepper */}
      <div className="flex items-center gap-0.5 bg-gray-50 rounded-lg border border-gray-200 flex-shrink-0">
        <button
          onClick={() => handleQuantityChange(-1)}
          disabled={item.quantity <= 1}
          className="w-7 h-7 flex items-center justify-center rounded-l-md text-gray-500 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          aria-label="Decrease quantity"
        >
          <Minus className="w-3 h-3" />
        </button>
        <span className="w-7 text-center text-xs font-semibold text-gray-700 tabular-nums select-none">
          {item.quantity}
        </span>
        <button
          onClick={() => handleQuantityChange(1)}
          className="w-7 h-7 flex items-center justify-center rounded-r-md text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          aria-label="Increase quantity"
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>

      {/* Price Input */}
      <div className="relative flex-shrink-0 w-20">
        <div className="absolute inset-y-0 left-0 flex items-center pl-2 pointer-events-none">
          <span className="text-xs text-gray-400 font-medium">$</span>
        </div>
        <input
          type="number"
          min="0"
          step="0.01"
          value={formatPrice(item.price)}
          onChange={handlePriceChange}
          placeholder="0.00"
          className="w-full h-8 pl-5 pr-2 rounded-lg border border-gray-200 bg-white text-xs text-gray-700 placeholder:text-gray-300 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/30 transition-all"
        />
      </div>

      {/* Purchased Toggle */}
      <button
        onClick={() => onPurchaseToggle(item.id, !item.purchased)}
        className={cn(
          'flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-200',
          item.purchased
            ? 'bg-purple-100 text-purple-600 shadow-sm'
            : 'bg-gray-50 text-gray-400 hover:text-purple-500 hover:bg-purple-50'
        )}
        title={item.purchased ? 'Mark as not purchased' : 'Mark as purchased'}
        aria-label="Toggle purchased status"
      >
        <ShoppingBag
          className={cn('w-4 h-4', item.purchased && 'fill-current')}
        />
      </button>

      {/* Delete Button */}
      <button
        onClick={() => onDelete(item.id)}
        className={cn(
          'flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-200',
          showDelete
            ? 'opacity-100 text-red-400 hover:text-red-600 hover:bg-red-50'
            : 'opacity-0'
        )}
        aria-label="Delete item"
        title="Delete item"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  )
}
