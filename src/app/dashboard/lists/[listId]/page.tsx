import { ArrowLeft, PlusCircle, CheckCircle, CheckSquare, Trash2, Edit, Share } from 'lucide-react'
import Link from 'next/link'
import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import ListItems from '@/components/lists/ListItems'

export default async function ListDetailPage({ params }: { params: { listId: string } }) {
  const sessionUser = await getServerUser()

  if (!sessionUser) {
    return null
  }

  const user = await prisma!.user.findUnique({
    where: { id: sessionUser.id },
    include: { family: true },
  })

  if (!user) {
    return null
  }

  // Get the list
  let list: any = null
  let items: any[] = []

  try {
    list = await (prisma as any).list.findUnique({
      where: { id: params.listId },
      include: { creator: { select: { name: true, avatar_url: true } } },
    })

    if (list) {
      items = await (prisma as any).list_item.findMany({
        where: { list_id: params.listId },
        include: {
          added_by_user: { select: { name: true, avatar_url: true } },
          checked_by_user: { select: { name: true } },
        },
        orderBy: { position: 'asc' },
      })
    }
  } catch (error) {
    console.error('Error fetching list:', error)
  }

  if (!list) {
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
            <CheckSquare className="w-8 h-8 text-gray-400" />
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-4">List Not Found</h2>
          <p className="text-gray-600 mb-6">
            The list you&apos;re looking for doesn&apos;t exist or you don&apos;t have access to it.
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

  const getListTypeIcon = (type: string) => {
    switch (type) {
      case 'grocery': return '🛒'
      case 'todo': return '✅'
      case 'meal_plan': return '🍽️'
      case 'wishlist': return '🎁'
      case 'shopping': return '🛍️'
      default: return '📝'
    }
  }

  const getListTypeColor = (type: string) => {
    switch (type) {
      case 'grocery': return 'bg-green-100 text-green-800'
      case 'todo': return 'bg-blue-100 text-blue-800'
      case 'meal_plan': return 'bg-yellow-100 text-yellow-800'
      case 'wishlist': return 'bg-pink-100 text-pink-800'
      case 'shopping': return 'bg-purple-100 text-purple-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const checkedItems = items.filter(item => item.checked).length
  const totalItems = items.length
  const progressPercentage = totalItems > 0 ? Math.round((checkedItems / totalItems) * 100) : 0

  return (
    <div className="max-w-4xl mx-auto">
      <Link
        href="/dashboard/lists"
        className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900 mb-8"
      >
        <ArrowLeft className="w-4 h-4 mr-2" />
        Back to Lists
      </Link>

      {/* List Header */}
      <div className="card">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-6">
          <div className="flex-1">
            <div className="flex items-center mb-4">
              <div className="text-2xl mr-3">{getListTypeIcon(list.type)}</div>
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-2xl font-bold text-gray-900">{list.name}</h1>
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${getListTypeColor(list.type)}`}>
                    {list.type.replace('_', ' ')}
                  </span>
                </div>
                <p className="text-gray-600 mt-2">{list.description}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600">
              <div className="flex items-center">
                <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center mr-2">
                  <span className="text-sm font-medium">
                    {list.creator?.name?.charAt(0).toUpperCase() || '?'}
                  </span>
                </div>
                Created by {list.creator?.name || 'Unknown'}
              </div>

              <div>
                Updated {new Date(list.updated_at).toLocaleDateString()}
              </div>

              <div className="flex items-center">
                <CheckCircle className="w-4 h-4 mr-1" />
                {checkedItems} of {totalItems} items completed
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              className="p-2 text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
              title="Share list"
            >
              <Share className="w-5 h-5" />
            </button>
            <button
              className="p-2 text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
              title="Edit list"
            >
              <Edit className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Progress Bar */}
        {totalItems > 0 && (
          <div className="mt-6 pt-6 border-t">
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="font-medium text-gray-900">Progress</span>
              <span className="text-gray-600">{progressPercentage}% complete</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-green-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${progressPercentage}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* List Items */}
      <ListItems
        listId={list.id}
        initialItems={items}
        listType={list.type}
        userId={sessionUser.id}
      />

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
        <div className="card">
          <div className="flex items-center">
            <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center mr-4">
              <CheckSquare className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-600">Completion Rate</p>
              <p className="text-2xl font-semibold text-gray-900">{progressPercentage}%</p>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center">
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center mr-4">
              <span className="text-lg">📝</span>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-600">Total Items</p>
              <p className="text-2xl font-semibold text-gray-900">{totalItems}</p>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center">
            <div className="w-10 h-10 bg-yellow-100 rounded-lg flex items-center justify-center mr-4">
              <span className="text-lg">👥</span>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-600">Contributors</p>
              <p className="text-2xl font-semibold text-gray-900">
                {new Set(items.map(item => item.added_by)).size || 1}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
