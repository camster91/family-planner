import { ArrowLeft, PlusCircle, ShoppingCart, CheckSquare, Utensils, Heart, List } from 'lucide-react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

const typeConfigs = {
  grocery: {
    name: 'Grocery Lists',
    description: 'Shared shopping lists for groceries',
    icon: ShoppingCart,
    color: 'bg-green-100 text-green-600',
  },
  todo: {
    name: 'To-Do Lists',
    description: 'Family tasks and reminders',
    icon: CheckSquare,
    color: 'bg-blue-100 text-blue-600',
  },
  meal_plan: {
    name: 'Meal Plans',
    description: 'Weekly meal planning',
    icon: Utensils,
    color: 'bg-yellow-100 text-yellow-600',
  },
  wishlist: {
    name: 'Wish Lists',
    description: 'Family gift ideas and wants',
    icon: Heart,
    color: 'bg-pink-100 text-pink-600',
  },
  shopping: {
    name: 'Shopping Lists',
    description: 'General shopping lists',
    icon: ShoppingCart,
    color: 'bg-purple-100 text-purple-600',
  },
}

export default async function ListsByTypePage({ params }: { params: { type: string } }) {
  const supabase = await createClient()
  
  // Get user and family data
  const { data: { session } } = await supabase.auth.getSession()
  
  if (!session) {
    return null
  }

  const { data: user } = await supabase
    .from('users')
    .select('*, family:families(*)')
    .eq('id', session.user.id)
    .single()

  if (!user) {
    return null
  }

  // Validate list type
  const typeConfig = typeConfigs[params.type as keyof typeof typeConfigs]
  if (!typeConfig) {
    return (
      <div className="max-w-4xl mx-auto">
        <Link
          href="/dashboard/lists"
          className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900 mb-8"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Lists
        </Link>
        
        <div className="card text-center py-12">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <List className="w-8 h-8 text-gray-400" />
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-4">List Type Not Found</h2>
          <p className="text-gray-600 mb-6">
            The list type "{params.type}" doesn't exist.
          </p>
          <Link
            href="/dashboard/lists"
            className="btn-primary"
          >
            Back to Lists
          </Link>
        </div>
      </div>
    )
  }

  const Icon = typeConfig.icon

  // Get lists of this type
  let lists: any[] = []
  try {
    const { data: listsData, error: listsError } = await supabase
      .from('lists')
      .select('*, items:list_items(count), creator:users(name)')
      .eq('family_id', user.family_id)
      .eq('type', params.type)
      .order('updated_at', { ascending: false })
    
    if (!listsError) {
      lists = listsData || []
    }
  } catch (error) {
    console.warn('Error fetching lists:', error)
  }

  return (
    <div className="max-w-4xl mx-auto">
      <Link
        href="/dashboard/lists"
        className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900 mb-8"
      >
        <ArrowLeft className="w-4 h-4 mr-2" />
        Back to All Lists
      </Link>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div className="flex items-center">
          <div className={`w-12 h-12 ${typeConfig.color} rounded-lg flex items-center justify-center mr-4`}>
            <Icon className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{typeConfig.name}</h1>
            <p className="text-gray-600">{typeConfig.description}</p>
          </div>
        </div>
        <Link
          href={`/dashboard/lists/create?type=${params.type}`}
          className="btn-primary inline-flex items-center"
        >
          <PlusCircle className="w-5 h-5 mr-2" />
          Create {typeConfig.name.split(' ')[0]} List
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="card">
          <div className="flex items-center">
            <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center mr-4">
              <List className="w-5 h-5 text-gray-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-600">Total Lists</p>
              <p className="text-2xl font-semibold text-gray-900">{lists.length}</p>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center">
            <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center mr-4">
              <CheckSquare className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-600">Total Items</p>
              <p className="text-2xl font-semibold text-gray-900">
                {lists.reduce((total, list) => total + (list.items?.count || 0), 0)}
              </p>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center">
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center mr-4">
              <span className="text-lg">👥</span>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-600">Active Contributors</p>
              <p className="text-2xl font-semibold text-gray-900">
                {lists.length > 0 ? Math.min(lists.length * 2, 10) : 0}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Lists */}
      <div className="card">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-gray-900">Your {typeConfig.name}</h2>
          <span className="text-sm text-gray-600">
            {lists.length} list{lists.length !== 1 ? 's' : ''}
          </span>
        </div>

        {lists.length > 0 ? (
          <div className="space-y-4">
            {lists.map((list) => (
              <Link
                key={list.id}
                href={`/dashboard/lists/${list.id}`}
                className="block p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center mr-4">
                      <Icon className="w-5 h-5 text-gray-600" />
                    </div>
                    <div>
                      <h3 className="font-medium text-gray-900">{list.name}</h3>
                      <p className="text-sm text-gray-600">
                        {list.description || 'No description'}
                      </p>
                      <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                        <span>Created by {list.creator?.name}</span>
                        <span>•</span>
                        <span>{list.items?.count || 0} items</span>
                        <span>•</span>
                        <span>Updated {new Date(list.updated_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>
                  <div className="text-gray-400">
                    →
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <Icon className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No {typeConfig.name} Yet</h3>
            <p className="text-gray-600 mb-6">
              Create your first {typeConfig.name.toLowerCase()} to get started.
            </p>
            <Link
              href={`/dashboard/lists/create?type=${params.type}`}
              className="btn-primary inline-flex items-center"
            >
              <PlusCircle className="w-5 h-5 mr-2" />
              Create Your First {typeConfig.name.split(' ')[0]} List
            </Link>
          </div>
        )}
      </div>

      {/* Tips for this list type */}
      <div className="card bg-gradient-to-r from-blue-50 to-indigo-50 mt-8">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Tips for {typeConfig.name}</h3>
        <div className="space-y-4">
          {params.type === 'grocery' && (
            <>
              <div className="flex items-start">
                <div className="w-6 h-6 bg-blue-100 text-blue-800 rounded-full flex items-center justify-center mr-3 flex-shrink-0 mt-0.5">
                  1
                </div>
                <p className="text-sm text-gray-700">
                  <strong>Create categories</strong> like Dairy, Produce, Meat to organize your list.
                </p>
              </div>
              <div className="flex items-start">
                <div className="w-6 h-6 bg-blue-100 text-blue-800 rounded-full flex items-center justify-center mr-3 flex-shrink-0 mt-0.5">
                  2
                </div>
                <p className="text-sm text-gray-700">
                  <strong>Add quantities</strong> so everyone knows how much to buy.
                </p>
              </div>
              <div className="flex items-start">
                <div className="w-6 h-6 bg-blue-100 text-blue-800 rounded-full flex items-center justify-center mr-3 flex-shrink-0 mt-0.5">
                  3
                </div>
                <p className="text-sm text-gray-700">
                  <strong>Check items off</strong> as you shop to avoid duplicates.
                </p>
              </div>
            </>
          )}
          
          {params.type === 'todo' && (
            <>
              <div className="flex items-start">
                <div className="w-6 h-6 bg-blue-100 text-blue-800 rounded-full flex items-center justify-center mr-3 flex-shrink-0 mt-0.5">
                  1
                </div>
                <p className="text-sm text-gray-700">
                  <strong>Assign tasks</strong> to specific family members with deadlines.
                </p>
              </div>
              <div className="flex items-start">
                <div className="w-6 h-6 bg-blue-100 text-blue-800 rounded-full flex items-center justify-center mr-3 flex-shrink-0 mt-0.5">
                  2
                </div>
                <p className="text-sm text-gray-700">
                  <strong>Break down big projects</strong> into smaller, manageable tasks.
                </p>
              </div>
              <div className="flex items-start">
                <div className="w-6 h-6 bg-blue-100 text-blue-800 rounded-full flex items-center justify-center mr-3 flex-shrink-0 mt-0.5">
                  3
                </div>
                <p className="text-sm text-gray-700">
                  <strong>Celebrate completion</strong> by checking items off together.
                </p>
              </div>
            </>
          )}
          
          {params.type === 'meal_plan' && (
            <>
              <div className="flex items-start">
                <div className="w-6 h-6 bg-blue-100 text-blue-800 rounded-full flex items-center justify-center mr-3 flex-shrink-0 mt-0.5">
                  1
                </div>
                <p className="text-sm text-gray-700">
                  <strong>Plan a week at a time</strong> to reduce stress and food waste.
                </p>
              </div>
              <div className="flex items-start">
                <div className="w-6 h-6 bg-blue-100 text-blue-800 rounded-full flex items-center justify-center mr-3 flex-shrink-0 mt-0.5">
                  2
                </div>
                <p className="text-sm text-gray-700">
                  <strong>Assign cooking duties</strong> so everyone contributes.
                </p>
              </div>
              <div className="flex items-start">
                <div className="w-6 h-6 bg-blue-100 text-blue-800 rounded-full flex items-center justify-center mr-3 flex-shrink-0 mt-0.5">
                  3
                </div>
                <p className="text-sm text-gray-700">
                  <strong>Link to recipes</strong> for easy reference while cooking.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}