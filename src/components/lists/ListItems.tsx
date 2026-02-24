'use client'

import { useState } from 'react'
import { CheckCircle, Circle, PlusCircle, Trash2, Edit, Save, X, CheckSquare } from 'lucide-react'

interface ListItem {
  id: string
  content: string
  checked: boolean
  quantity: number
  category?: string
  notes?: string
  added_by: {
    name: string
    avatar_url?: string
  }
  checked_by?: {
    name: string
  }
  checked_at?: string
}

interface ListItemsProps {
  listId: string
  initialItems: ListItem[]
  listType: string
  userId: string
}

export default function ListItems({ listId, initialItems, listType, userId }: ListItemsProps) {
  const [items, setItems] = useState<ListItem[]>(initialItems)
  const [newItemContent, setNewItemContent] = useState('')
  const [newItemCategory, setNewItemCategory] = useState('')
  const [newItemQuantity, setNewItemQuantity] = useState(1)
  const [addingItem, setAddingItem] = useState(false)
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [editingContent, setEditingContent] = useState('')
  const [loading, setLoading] = useState(false)

  const handleAddItem = async () => {
    if (!newItemContent.trim() || loading) return

    setLoading(true)
    try {
      const response = await fetch('/api/lists/items/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          listId,
          content: newItemContent,
          quantity: newItemQuantity,
          category: newItemCategory.trim() || null,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to add item')
      }

      setItems([...items, data.item])
      setNewItemContent('')
      setNewItemCategory('')
      setNewItemQuantity(1)
      setAddingItem(false)
    } catch (error) {
      console.error('Error adding item:', error)
      alert(error instanceof Error ? error.message : 'Failed to add item')
    } finally {
      setLoading(false)
    }
  }

  const handleToggleItem = async (itemId: string, currentlyChecked: boolean) => {
    try {
      const response = await fetch('/api/lists/items/update', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          itemId,
          checked: !currentlyChecked,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update item')
      }

      setItems(items.map(item => 
        item.id === itemId ? { ...item, ...data.item } : item
      ))
    } catch (error) {
      console.error('Error toggling item:', error)
      alert(error instanceof Error ? error.message : 'Failed to update item')
    }
  }

  const handleUpdateItem = async (itemId: string) => {
    if (!editingContent.trim()) return

    try {
      const response = await fetch('/api/lists/items/update', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          itemId,
          content: editingContent,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update item')
      }

      setItems(items.map(item => 
        item.id === itemId ? { ...item, ...data.item } : item
      ))
      setEditingItemId(null)
      setEditingContent('')
    } catch (error) {
      console.error('Error updating item:', error)
      alert(error instanceof Error ? error.message : 'Failed to update item')
    }
  }

  const handleDeleteItem = async (itemId: string) => {
    if (!confirm('Are you sure you want to delete this item?')) return

    try {
      const response = await fetch(`/api/lists/items/delete?itemId=${itemId}`, {
        method: 'DELETE',
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete item')
      }

      setItems(items.filter(item => item.id !== itemId))
    } catch (error) {
      console.error('Error deleting item:', error)
      alert(error instanceof Error ? error.message : 'Failed to delete item')
    }
  }

  const categories = Array.from(new Set(items.map(item => item.category).filter(Boolean))) as string[]

  return (
    <div className="card mt-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-gray-900">Items</h2>
        <button
          onClick={() => setAddingItem(true)}
          className="btn-primary inline-flex items-center"
        >
          <PlusCircle className="w-5 h-5 mr-2" />
          Add Item
        </button>
      </div>

      {/* Add Item Form */}
      {addingItem && (
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg mb-6">
          <div className="flex items-center mb-4">
            <PlusCircle className="w-5 h-5 text-blue-600 mr-3" />
            <h3 className="font-medium text-blue-900">Add New Item</h3>
          </div>
          
          <div className="space-y-4">
            <div>
              <input
                type="text"
                value={newItemContent}
                onChange={(e) => setNewItemContent(e.target.value)}
                placeholder="What do you need to add?"
                className="input-field"
                autoFocus
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Category (optional)
                </label>
                <input
                  type="text"
                  value={newItemCategory}
                  onChange={(e) => setNewItemCategory(e.target.value)}
                  placeholder="e.g., Dairy, Produce"
                  className="input-field"
                  list="categories"
                />
                <datalist id="categories">
                  {categories.map(category => (
                    <option key={category} value={category} />
                  ))}
                </datalist>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Quantity
                </label>
                <div className="flex items-center">
                  <button
                    type="button"
                    onClick={() => setNewItemQuantity(Math.max(1, newItemQuantity - 1))}
                    className="px-3 py-2 border border-gray-300 rounded-l-lg hover:bg-gray-50"
                  >
                    -
                  </button>
                  <input
                    type="number"
                    min="1"
                    value={newItemQuantity}
                    onChange={(e) => setNewItemQuantity(parseInt(e.target.value) || 1)}
                    className="w-16 text-center border-t border-b border-gray-300 py-2"
                  />
                  <button
                    type="button"
                    onClick={() => setNewItemQuantity(newItemQuantity + 1)}
                    className="px-3 py-2 border border-gray-300 rounded-r-lg hover:bg-gray-50"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
            
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => {
                  setAddingItem(false)
                  setNewItemContent('')
                  setNewItemCategory('')
                }}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleAddItem}
                disabled={!newItemContent.trim() || loading}
                className="btn-primary"
              >
                {loading ? 'Adding...' : 'Add Item'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Items List */}
      {items.length > 0 ? (
        <div className="space-y-3">
          {items.map((item) => (
            <div
              key={item.id}
              className={`p-4 rounded-lg border transition ${
                item.checked
                  ? 'bg-green-50 border-green-200'
                  : 'bg-white border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center">
                <button
                  onClick={() => handleToggleItem(item.id, item.checked)}
                  className={`mr-4 flex-shrink-0 ${
                    item.checked ? 'text-green-600' : 'text-gray-400 hover:text-gray-600'
                  }`}
                  title={item.checked ? 'Mark as incomplete' : 'Mark as complete'}
                >
                  {item.checked ? (
                    <CheckCircle className="w-6 h-6" />
                  ) : (
                    <Circle className="w-6 h-6" />
                  )}
                </button>
                
                <div className="flex-1">
                  {editingItemId === item.id ? (
                    <div className="flex items-center space-x-2">
                      <input
                        type="text"
                        value={editingContent}
                        onChange={(e) => setEditingContent(e.target.value)}
                        className="input-field flex-1"
                        autoFocus
                      />
                      <button
                        onClick={() => handleUpdateItem(item.id)}
                        className="p-2 text-green-600 hover:text-green-700 hover:bg-green-50 rounded-lg"
                        title="Save"
                      >
                        <Save className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => {
                          setEditingItemId(null)
                          setEditingContent('')
                        }}
                        className="p-2 text-gray-600 hover:text-gray-700 hover:bg-gray-50 rounded-lg"
                        title="Cancel"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-start">
                      <div className="flex-1">
                        <div className={`font-medium ${item.checked ? 'line-through text-gray-500' : 'text-gray-900'}`}>
                          {item.content}
                        </div>
                        
                        <div className="flex flex-wrap items-center gap-3 mt-2 text-sm text-gray-600">
                          {item.quantity > 1 && (
                            <span className="px-2 py-1 bg-gray-100 rounded">
                              {item.quantity}x
                            </span>
                          )}
                          
                          {item.category && (
                            <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded">
                              {item.category}
                            </span>
                          )}
                          
                          {item.added_by && (
                            <span>
                              Added by {item.added_by.name}
                            </span>
                          )}
                          
                          {item.checked && item.checked_by && (
                            <span className="text-green-700">
                              ✓ Completed by {item.checked_by.name} on {new Date(item.checked_at!).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </div>
                      
                      <div className="flex items-center space-x-1 ml-4">
                        <button
                          onClick={() => {
                            setEditingItemId(item.id)
                            setEditingContent(item.content)
                          }}
                          className="p-2 text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                          title="Edit item"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteItem(item.id)}
                          className="p-2 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg"
                          title="Delete item"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-12">
          <CheckSquare className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No Items Yet</h3>
          <p className="text-gray-600 mb-6">
            {listType === 'grocery' 
              ? 'Start by adding items to your grocery list.'
              : listType === 'todo'
              ? 'Add tasks to your to-do list.'
              : 'Add items to your list.'}
          </p>
          <button
            onClick={() => setAddingItem(true)}
            className="btn-primary inline-flex items-center"
          >
            <PlusCircle className="w-5 h-5 mr-2" />
            Add Your First Item
          </button>
        </div>
      )}

      {/* Quick Actions */}
      {items.length > 0 && (
        <div className="mt-8 pt-8 border-t">
          <h3 className="text-sm font-medium text-gray-900 mb-4">Quick Actions</h3>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => {
                const allChecked = items.every(item => item.checked)
                items.forEach(item => {
                  if (allChecked ? item.checked : !item.checked) {
                    handleToggleItem(item.id, item.checked)
                  }
                })
              }}
              className="px-4 py-2 bg-blue-100 text-blue-800 rounded-lg text-sm font-medium hover:bg-blue-200"
            >
              {items.every(item => item.checked) ? 'Uncheck All' : 'Check All'}
            </button>
            
            <button
              onClick={() => {
                if (confirm('Delete all checked items?')) {
                  items.forEach(item => {
                    if (item.checked) {
                      handleDeleteItem(item.id)
                    }
                  })
                }
              }}
              className="px-4 py-2 bg-red-100 text-red-800 rounded-lg text-sm font-medium hover:bg-red-200"
              disabled={!items.some(item => item.checked)}
            >
              Delete Checked Items
            </button>
          </div>
        </div>
      )}
    </div>
  )
}