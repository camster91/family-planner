'use client'

import { useState, useEffect, useCallback } from 'react'
import { X, Plus, Pencil, Trash2, Loader2, Palette } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Category {
  id: string
  name: string
  icon: string
  color: string
  type: 'income' | 'expense'
  budget_limit: number | null
  _count?: { transactions: number }
}

interface CategoryManagerProps {
  onClose: () => void
  onUpdated: () => void
}

const EMOJI_OPTIONS = ['💰', '🏠', '🛒', '🚗', '🍕', '🎮', '📚', '💊', '👕', '✈️', '🎁', '🐾', '🎓', '🔧', '💡', '📱', '🏥', '🎬', '🌿', '☕']

const COLOR_OPTIONS = [
  '#EF4444', '#F97316', '#F59E0B', '#84CC16', '#10B981',
  '#06B6D4', '#3B82F6', '#6366F1', '#8B5CF6', '#EC4899',
  '#F43F5E', '#14B8A6', '#0EA5E9', '#A855F7', '#78716C',
]

export default function CategoryManager({ onClose, onUpdated }: CategoryManagerProps) {
  const [categories, setCategories] = useState<Category[]>([])
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Form state
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('📦')
  const [color, setColor] = useState('#6366F1')
  const [type, setType] = useState<'income' | 'expense'>('expense')
  const [budgetLimit, setBudgetLimit] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const fetchCategories = useCallback(async () => {
    try {
      const res = await fetch('/api/budget/categories')
      if (res.ok) {
        const json = await res.json()
        setCategories(json.categories)
      }
    } catch (err) {
      console.error('Failed to fetch categories:', err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchCategories()
  }, [fetchCategories])

  const resetForm = () => {
    setName('')
    setIcon('📦')
    setColor('#6366F1')
    setType('expense')
    setBudgetLimit('')
    setError('')
  }

  const handleAdd = () => {
    resetForm()
    setShowAddForm(true)
    setEditingId(null)
  }

  const handleEdit = (cat: Category) => {
    setName(cat.name)
    setIcon(cat.icon)
    setColor(cat.color)
    setType(cat.type)
    setBudgetLimit(cat.budget_limit ? String(cat.budget_limit) : '')
    setEditingId(cat.id)
    setShowAddForm(true)
    setError('')
  }

  const handleCancel = () => {
    setShowAddForm(false)
    setEditingId(null)
    resetForm()
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!name.trim()) {
      setError('Category name is required')
      return
    }

    setIsSubmitting(true)

    try {
      const isEditing = !!editingId
      const url = isEditing
        ? `/api/budget/categories/${editingId}`
        : '/api/budget/categories'

      const method = isEditing ? 'PATCH' : 'POST'

      const body: Record<string, unknown> = {
        name: name.trim(),
        icon,
        color,
        type,
        budget_limit: budgetLimit ? parseFloat(budgetLimit) : null,
      }

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const json = await res.json()
        setError(json.error || 'Failed to save category')
        setIsSubmitting(false)
        return
      }

      await fetchCategories()
      onUpdated()
      handleCancel()
    } catch (err) {
      console.error('Failed to save category:', err)
      setError('Network error. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this category? Transactions in this category will become uncategorized.')) {
      return
    }

    setDeletingId(id)
    try {
      const res = await fetch(`/api/budget/categories/${id}`, { method: 'DELETE' })
      if (res.ok) {
        setCategories((prev) => prev.filter((c) => c.id !== id))
        onUpdated()
      }
    } catch (err) {
      console.error('Failed to delete category:', err)
    } finally {
      setDeletingId(null)
    }
  }

  const handleBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose()
  }

  const incomeCategories = categories.filter((c) => c.type === 'income')
  const expenseCategories = categories.filter((c) => c.type === 'expense')

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={handleBackdrop}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden animate-slide-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-lg font-semibold text-gray-900">Categories</h2>
          <div className="flex items-center gap-2">
            {!showAddForm && (
              <button
                onClick={handleAdd}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Add/Edit Form */}
          {showAddForm && (
            <form onSubmit={handleSubmit} className="bg-gray-50 rounded-xl p-4 space-y-4 border border-gray-200">
              <h3 className="text-sm font-semibold text-gray-900">
                {editingId ? 'Edit Category' : 'New Category'}
              </h3>

              {/* Type */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setType('expense')}
                  className={cn(
                    'flex-1 py-1.5 px-3 rounded-lg text-xs font-medium border transition-colors',
                    type === 'expense'
                      ? 'border-rose-300 bg-rose-50 text-rose-700'
                      : 'border-gray-200 bg-white text-gray-500'
                  )}
                >
                  Expense
                </button>
                <button
                  type="button"
                  onClick={() => setType('income')}
                  className={cn(
                    'flex-1 py-1.5 px-3 rounded-lg text-xs font-medium border transition-colors',
                    type === 'income'
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                      : 'border-gray-200 bg-white text-gray-500'
                  )}
                >
                  Income
                </button>
              </div>

              {/* Name */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Groceries, Salary..."
                  autoFocus
                  className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder:text-gray-400"
                />
              </div>

              {/* Emoji Picker */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Icon</label>
                <div className="flex flex-wrap gap-1.5">
                  {EMOJI_OPTIONS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => setIcon(emoji)}
                      className={cn(
                        'w-8 h-8 flex items-center justify-center rounded-lg text-base transition-all',
                        icon === emoji
                          ? 'bg-indigo-100 ring-2 ring-indigo-400 scale-110'
                          : 'bg-white hover:bg-gray-100'
                      )}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>

              {/* Color Picker */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Color</label>
                <div className="flex flex-wrap gap-1.5">
                  {COLOR_OPTIONS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(c)}
                      className={cn(
                        'w-7 h-7 rounded-full transition-all border-2',
                        color === c ? 'border-gray-900 scale-110 shadow-md' : 'border-transparent hover:scale-105'
                      )}
                      style={{ backgroundColor: c }}
                      title={c}
                    />
                  ))}
                </div>
              </div>

              {/* Budget Limit */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Budget Limit <span className="text-gray-400">(optional)</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">$</span>
                  <input
                    type="number"
                    value={budgetLimit}
                    onChange={(e) => setBudgetLimit(e.target.value)}
                    placeholder="0.00"
                    min="0"
                    step="0.01"
                    className="w-full pl-7 pr-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder:text-gray-400"
                  />
                </div>
              </div>

              {/* Error */}
              {error && (
                <p className="text-xs text-rose-600 bg-rose-50 px-3 py-1.5 rounded-lg">{error}</p>
              )}

              {/* Form actions */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleCancel}
                  className="flex-1 px-3 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className={cn(
                    'flex-1 px-3 py-2 text-sm font-medium text-white rounded-lg transition-colors flex items-center justify-center gap-1.5',
                    isSubmitting ? 'bg-indigo-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700'
                  )}
                >
                  {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {editingId ? 'Save' : 'Create'}
                </button>
              </div>
            </form>
          )}

          {/* Loading */}
          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 text-gray-400 animate-spin" />
            </div>
          )}

          {/* Income Categories */}
          {!isLoading && incomeCategories.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                Income Categories
              </h3>
              <div className="space-y-2">
                {incomeCategories.map((cat) => (
                  <CategoryCard
                    key={cat.id}
                    category={cat}
                    onEdit={() => handleEdit(cat)}
                    onDelete={() => handleDelete(cat.id)}
                    isDeleting={deletingId === cat.id}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Expense Categories */}
          {!isLoading && expenseCategories.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                Expense Categories
              </h3>
              <div className="space-y-2">
                {expenseCategories.map((cat) => (
                  <CategoryCard
                    key={cat.id}
                    category={cat}
                    onEdit={() => handleEdit(cat)}
                    onDelete={() => handleDelete(cat.id)}
                    isDeleting={deletingId === cat.id}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Empty state */}
          {!isLoading && categories.length === 0 && !showAddForm && (
            <div className="text-center py-12">
              <p className="text-gray-400 text-sm">No categories yet</p>
              <button
                onClick={handleAdd}
                className="mt-3 text-sm font-medium text-indigo-600 hover:text-indigo-700"
              >
                Create your first category
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Individual category card component
function CategoryCard({
  category,
  onEdit,
  onDelete,
  isDeleting,
}: {
  category: Category
  onEdit: () => void
  onDelete: () => void
  isDeleting: boolean
}) {
  return (
    <div
      className="flex items-center justify-between p-3 bg-white border border-gray-100 rounded-xl hover:shadow-sm transition-shadow group"
    >
      <div className="flex items-center gap-3 min-w-0">
        {/* Colored left border dot */}
        <div
          className="w-1 h-8 rounded-full flex-shrink-0"
          style={{ backgroundColor: category.color }}
        />
        <span className="text-xl flex-shrink-0">{category.icon}</span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">{category.name}</p>
          <p className="text-xs text-gray-400">
            {category._count?.transactions ?? 0} transaction{(category._count?.transactions ?? 0) !== 1 ? 's' : ''}
            {category.budget_limit && (
              <span> · Budget: ${category.budget_limit}</span>
            )}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={onEdit}
          className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
          title="Edit"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onDelete}
          disabled={isDeleting}
          className="p-1.5 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors disabled:opacity-50"
          title="Delete"
        >
          {isDeleting ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Trash2 className="w-3.5 h-3.5" />
          )}
        </button>
      </div>
    </div>
  )
}
