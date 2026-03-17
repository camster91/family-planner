import { List, PlusCircle, ShoppingCart, CheckSquare, Utensils, Heart } from 'lucide-react'
import Link from 'next/link'
import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'

export default async function ListsPage() {
  const sessionUser = await getServerUser()

  if (!sessionUser) {
    return null
  }

  const user = await prisma!.user.findUnique({
    where: { id: sessionUser.id },
    include: { family: true }
  })

  if (!user) {
    return null
  }

  // Get family lists
  let lists: any[] = []
  try {
    const listsData = await (prisma as any).list.findMany({
      where: { family_id: user.family_id },
      include: {
        items: true,
        creator: { select: { name: true } }
      },
      orderBy: { updated_at: 'desc' }
    })
    lists = listsData || []
  } catch (error) {
    console.warn('Error fetching lists:', error)
    // Table might not exist yet - that's okay for now
  }

  const listTypes = [
    {
      type: 'grocery',
      name: 'Grocery List',
      description: 'Shared shopping list for the family',
      icon: ShoppingCart,
      color: 'bg-green-100 text-green-600',
    },
    {
      type: 'todo',
      name: 'To-Do List',
      description: 'Family tasks and reminders',
      icon: CheckSquare,
      color: 'bg-blue-100 text-blue-600',
    },
    {
      type: 'meal_plan',
      name: 'Meal Plan',
      description: 'Weekly meal planning',
      icon: Utensils,
      color: 'bg-yellow-100 text-yellow-600',
    },
    {
      type: 'wishlist',
      name: 'Wish List',
      description: 'Family gift ideas and wants',
      icon: Heart,
      color: 'bg-pink-100 text-pink-600',
    },
  ]

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Shared Lists</h1>
          <p className="mt-2 text-gray-600">
            Collaborative lists for groceries, meal planning, and family tasks
          </p>
        </div>
        <Link
          href="/dashboard/lists/create"
          className="btn-primary inline-flex items-center"
        >
          <PlusCircle className="w-5 h-5 mr-2" />
          Create List
        </Link>
      </div>

      {/* List Types */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {listTypes.map((listType) => (
          <Link
            key={listType.type}
            href={`/dashboard/lists/type/${listType.type}`}
            className="card hover:shadow-md transition cursor-pointer"
          >
            <div className="flex items-center mb-4">
              <div className={`w-12 h-12 ${listType.color} rounded-lg flex items-center justify-center mr-4`}>
                <listType.icon className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">{listType.name}</h3>
                <p className="text-sm text-gray-600">{listType.description}</p>
              </div>
            </div>
            <div className="text-sm text-gray-500">
              Click to view and manage
            </div>
          </Link>
        ))}
      </div>

      {/* Recent Lists */}
      <div className="card">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-gray-900">Recent Lists</h2>
          <Link
            href="/dashboard/lists/all"
            className="text-sm font-medium text-blue-600 hover:text-blue-500"
          >
            View all →
          </Link>
        </div>

        {lists && lists.length > 0 ? (
          <div className="space-y-4">
            {lists.map((list) => (
              <div
                key={list.id}
                className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center mr-4">
                      <List className="w-5 h-5 text-gray-600" />
                    </div>
                    <div>
                      <h3 className="font-medium text-gray-900">{list.name}</h3>
                      <p className="text-sm text-gray-600">
                        Created by {list.creator?.name} • {list.items?.length || 0} items
                      </p>
                    </div>
                  </div>
                  <div className="text-sm text-gray-500">
                    Updated {new Date(list.updated_at).toLocaleDateString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <List className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No Lists Yet</h3>
            <p className="text-gray-600 mb-6">
              Create your first shared list for groceries, meal planning, or family tasks.
            </p>
            <Link
              href="/dashboard/lists/create"
              className="btn-primary inline-flex items-center"
            >
              <PlusCircle className="w-5 h-5 mr-2" />
              Create Your First List
            </Link>
          </div>
        )}
      </div>

      {/* How to Use */}
      <div className="card bg-gradient-to-r from-purple-50 to-indigo-50">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">How Shared Lists Work</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="space-y-2">
            <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
              <span className="font-bold text-purple-600">1</span>
            </div>
            <h4 className="font-medium text-gray-900">Create List</h4>
            <p className="text-sm text-gray-600">
              Choose a list type (grocery, todo, meal plan) and give it a name.
            </p>
          </div>
          <div className="space-y-2">
            <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
              <span className="font-bold text-purple-600">2</span>
            </div>
            <h4 className="font-medium text-gray-900">Add Items</h4>
            <p className="text-sm text-gray-600">
              Family members can add items, check them off, or add notes.
            </p>
          </div>
          <div className="space-y-2">
            <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
              <span className="font-bold text-purple-600">3</span>
            </div>
            <h4 className="font-medium text-gray-900">Collaborate</h4>
            <p className="text-sm text-gray-600">
              Everyone sees real-time updates. Perfect for shopping or meal planning.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
