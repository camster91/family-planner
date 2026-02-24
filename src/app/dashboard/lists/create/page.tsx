'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, Save, List, ShoppingCart, CheckSquare, Utensils, Heart } from 'lucide-react'
import Link from 'next/link'

export default function CreateListPage() {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [type, setType] = useState('grocery')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    const urlType = searchParams.get('type')
    if (urlType && ['grocery', 'todo', 'meal_plan', 'wishlist', 'shopping'].includes(urlType)) {
      setType(urlType)
    }
  }, [searchParams])

  const listTypes = [
    {
      value: 'grocery',
      label: 'Grocery List',
      icon: ShoppingCart,
      description: 'Shared shopping list for groceries',
      color: 'bg-green-100 text-green-600',
    },
    {
      value: 'todo',
      label: 'To-Do List',
      icon: CheckSquare,
      description: 'Family tasks and reminders',
      color: 'bg-blue-100 text-blue-600',
    },
    {
      value: 'meal_plan',
      label: 'Meal Plan',
      icon: Utensils,
      description: 'Weekly meal planning',
      color: 'bg-yellow-100 text-yellow-600',
    },
    {
      value: 'wishlist',
      label: 'Wish List',
      icon: Heart,
      description: 'Family gift ideas and wants',
      color: 'bg-pink-100 text-pink-600',
    },
    {
      value: 'shopping',
      label: 'Shopping List',
      icon: ShoppingCart,
      description: 'General shopping list',
      color: 'bg-purple-100 text-purple-600',
    },
  ]

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch('/api/lists/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name,
          type,
          description: description || null,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create list')
      }

      setSuccess('List created successfully!')
      
      // Redirect after a brief delay
      setTimeout(() => {
        router.push('/dashboard/lists')
        router.refresh()
      }, 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <Link
        href="/dashboard/lists"
        className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900 mb-8"
      >
        <ArrowLeft className="w-4 h-4 mr-2" />
        Back to Lists
      </Link>

      <div className="card">
        <div className="flex items-center mb-6">
          <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center mr-4">
            <List className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Create New List</h2>
            <p className="text-gray-600">Create a shared list for your family to collaborate on</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md">
              {error}
            </div>
          )}

          {success && (
            <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-md">
              {success}
            </div>
          )}

          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-2">
              List Name *
            </label>
            <input
              id="name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input-field"
              placeholder="e.g., Weekly Groceries, Family To-Do, Christmas Wishlist"
            />
          </div>

          <div>
            <label htmlFor="type" className="block text-sm font-medium text-gray-700 mb-4">
              List Type *
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {listTypes.map((listType) => {
                const Icon = listType.icon
                return (
                  <button
                    key={listType.value}
                    type="button"
                    onClick={() => setType(listType.value)}
                    className={`p-4 rounded-lg border-2 text-left transition ${
                      type === listType.value
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center mb-2">
                      <div className={`w-10 h-10 ${listType.color} rounded-lg flex items-center justify-center mr-3`}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="font-medium text-gray-900">{listType.label}</div>
                        <div className="text-xs text-gray-600">{listType.description}</div>
                      </div>
                    </div>
                    {type === listType.value && (
                      <div className="text-xs text-blue-600 font-medium mt-2">
                        ✓ Selected
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-2">
              Description (Optional)
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="input-field"
              placeholder="Describe what this list is for..."
            />
            <p className="mt-2 text-sm text-gray-600">
              Add any specific instructions or context for family members.
            </p>
          </div>

          <div className="flex items-center pt-6 border-t">
            <div className="flex-1">
              <div className="text-sm text-gray-600">
                <p>Your family members will be able to:</p>
                <ul className="list-disc pl-5 mt-1 space-y-1">
                  <li>View and edit this list</li>
                  <li>Add and remove items</li>
                  <li>Check off completed items</li>
                  <li>See real-time updates</li>
                </ul>
              </div>
            </div>
            <button
              type="submit"
              disabled={loading || !name.trim()}
              className="btn-primary inline-flex items-center"
            >
              <Save className="w-4 h-4 mr-2" />
              {loading ? 'Creating...' : 'Create List'}
            </button>
          </div>
        </form>
      </div>

      {/* List Ideas */}
      <div className="mt-8 card">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">List Ideas</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 bg-gray-50 rounded-lg">
            <div className="flex items-center mb-2">
              <ShoppingCart className="w-5 h-5 text-green-600 mr-2" />
              <h4 className="font-medium text-gray-900">Weekly Groceries</h4>
            </div>
            <p className="text-sm text-gray-600">
              Create categories like Dairy, Produce, Meat, etc. Everyone adds items they need.
            </p>
          </div>
          <div className="p-4 bg-gray-50 rounded-lg">
            <div className="flex items-center mb-2">
              <CheckSquare className="w-5 h-5 text-blue-600 mr-2" />
              <h4 className="font-medium text-gray-900">Weekend Projects</h4>
            </div>
            <p className="text-sm text-gray-600">
              Track home improvement tasks. Assign family members and set deadlines.
            </p>
          </div>
          <div className="p-4 bg-gray-50 rounded-lg">
            <div className="flex items-center mb-2">
              <Utensils className="w-5 h-5 text-yellow-600 mr-2" />
              <h4 className="font-medium text-gray-900">Meal Rotation</h4>
            </div>
            <p className="text-sm text-gray-600">
              Plan meals for the week. Link to recipes and assign cooking duties.
            </p>
          </div>
          <div className="p-4 bg-gray-50 rounded-lg">
            <div className="flex items-center mb-2">
              <Heart className="w-5 h-5 text-pink-600 mr-2" />
              <h4 className="font-medium text-gray-900">Birthday Wishlist</h4>
            </div>
            <p className="text-sm text-gray-600">
              Family members add gift ideas with links and price ranges.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}