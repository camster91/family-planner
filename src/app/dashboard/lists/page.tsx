import { Suspense } from 'react'
import {
  PlusCircle,
  ShoppingCart,
  CheckSquare,
  Utensils,
  Heart,
  List,
  ShoppingBag,
  Clock,
} from 'lucide-react'
import Link from 'next/link'
import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { cn } from '@/lib/utils'
import ListsFilterTabs from '@/components/lists/ListsFilterTabs'

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: Promise<{ type?: string }>
}

export default async function ListsPage({ searchParams }: PageProps) {
  const sessionUser = await getServerUser()

  if (!sessionUser) {
    return null
  }

  const user = await prisma!.user.findUnique({
    where: { id: sessionUser.id },
    include: { family: true },
  })

  if (!user || !user.family_id) {
    return null
  }

  // Read search params for filtering
  const params = await searchParams
  const activeType = params.type || 'all'

  // Fetch all family lists with item counts
  let lists: any[] = []
  try {
    lists = await prisma!.list.findMany({
      where: { family_id: user.family_id },
      include: {
        _count: { select: { items: true } },
        items: {
          select: { checked: true },
        },
        creator: { select: { name: true } },
      },
      orderBy: { updated_at: 'desc' },
    })
  } catch (error) {
    console.warn('Error fetching lists:', error)
    // Table might not exist yet
  }

  // Filter by type if not 'all'
  const filteredLists =
    activeType === 'all'
      ? lists
      : lists.filter((l) => l.type === activeType)

  // Type definitions with icons and colors (Monetoni-inspired soft palette)
  const typeConfig: Record<
    string,
    {
      name: string
      icon: typeof ShoppingCart
      gradient: string
      bgLight: string
      textColor: string
      ring: string
    }
  > = {
    grocery: {
      name: 'Grocery',
      icon: ShoppingCart,
      gradient: 'from-emerald-400 to-teal-500',
      bgLight: 'bg-emerald-50',
      textColor: 'text-emerald-700',
      ring: 'ring-emerald-200',
    },
    shopping: {
      name: 'Shopping',
      icon: ShoppingBag,
      gradient: 'from-violet-400 to-purple-500',
      bgLight: 'bg-violet-50',
      textColor: 'text-violet-700',
      ring: 'ring-violet-200',
    },
    todo: {
      name: 'To-Do',
      icon: CheckSquare,
      gradient: 'from-sky-400 to-blue-500',
      bgLight: 'bg-sky-50',
      textColor: 'text-sky-700',
      ring: 'ring-sky-200',
    },
    wishlist: {
      name: 'Wishlist',
      icon: Heart,
      gradient: 'from-pink-400 to-rose-500',
      bgLight: 'bg-pink-50',
      textColor: 'text-pink-700',
      ring: 'ring-pink-200',
    },
    meal_plan: {
      name: 'Meal Plan',
      icon: Utensils,
      gradient: 'from-amber-400 to-orange-500',
      bgLight: 'bg-amber-50',
      textColor: 'text-amber-700',
      ring: 'ring-amber-200',
    },
  }

  const getTypeConfig = (type: string) => {
    return (
      typeConfig[type] || {
        name: type.replace('_', ' '),
        icon: List,
        gradient: 'from-gray-400 to-gray-500',
        bgLight: 'bg-gray-50',
        textColor: 'text-gray-700',
        ring: 'ring-gray-200',
      }
    )
  }

  const tabs = [
    { key: 'all', label: 'All' },
    { key: 'grocery', label: 'Grocery' },
    { key: 'shopping', label: 'Shopping' },
    { key: 'todo', label: 'To-Do' },
    { key: 'wishlist', label: 'Wishlist' },
  ]

  const formatDate = (date: string) => {
    const d = new Date(date)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Shared Lists</h1>
          <p className="mt-1.5 text-gray-500">
            Collaborative lists for groceries, shopping, and family tasks
          </p>
        </div>
        <Link
          href="/dashboard/lists/create"
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-xl hover:bg-gray-800 transition-colors shadow-sm"
        >
          <PlusCircle className="w-4 h-4" />
          Create List
        </Link>
      </div>

      {/* Filter Tabs */}
      <Suspense fallback={null}>
        <ListsFilterTabs tabs={tabs} activeType={activeType} />
      </Suspense>

      {/* Quick-Type Cards (shown when "All" filter is active and no lists yet) */}
      {activeType === 'all' && filteredLists.length === 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {Object.entries(typeConfig).map(([type, config]) => (
            <Link
              key={type}
              href={`/dashboard/lists?type=${type}`}
              className={cn(
                'flex flex-col items-center gap-2 p-4 rounded-2xl border transition-all duration-200 hover:shadow-md',
                config.bgLight,
                'border-transparent hover:border-gray-200'
              )}
            >
              <div
                className={cn(
                  'w-12 h-12 rounded-xl bg-gradient-to-br flex items-center justify-center',
                  config.gradient
                )}
              >
                <config.icon className="w-5 h-5 text-white" />
              </div>
              <span className="text-sm font-medium text-gray-700">{config.name}</span>
            </Link>
          ))}
        </div>
      )}

      {/* Lists Grid */}
      {filteredLists.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredLists.map((list: any) => {
            const config = getTypeConfig(list.type)
            const checkedCount = (list.items || []).filter((i: any) => i.checked).length
            const totalCount = list._count?.items || 0
            const Icon = config.icon

            return (
              <Link
                key={list.id}
                href={`/dashboard/lists/${list.id}`}
                className={cn(
                  'group flex flex-col p-5 rounded-2xl bg-white border border-gray-100 shadow-sm hover:shadow-md transition-all duration-200',
                  'hover:border-gray-200'
                )}
              >
                {/* Top row: icon + info */}
                <div className="flex items-start gap-3 mb-4">
                  <div
                    className={cn(
                      'w-10 h-10 rounded-xl bg-gradient-to-br flex items-center justify-center flex-shrink-0 shadow-sm',
                      config.gradient
                    )}
                  >
                    <Icon className="w-5 h-5 text-white" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-gray-900 truncate group-hover:text-gray-700 transition-colors">
                      {list.name}
                    </h3>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {config.name} · by {list.creator?.name || 'Unknown'}
                    </p>
                  </div>
                </div>

                {/* Progress bar */}
                {totalCount > 0 && (
                  <div className="mb-3">
                    <div className="flex justify-between text-xs text-gray-500 mb-1.5">
                      <span className="font-medium">
                        {checkedCount}/{totalCount} items
                      </span>
                      <span>{Math.round((checkedCount / totalCount) * 100)}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all duration-500',
                          checkedCount === totalCount
                            ? 'bg-emerald-400'
                            : 'bg-gradient-to-r from-blue-400 to-blue-500'
                        )}
                        style={{ width: `${(checkedCount / totalCount) * 100}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Bottom row: meta */}
                <div className="flex items-center justify-between mt-auto pt-3 border-t border-gray-50">
                  {list.is_repeatable && (
                    <span className="inline-flex items-center gap-1 text-xs text-teal-600 bg-teal-50 px-2 py-0.5 rounded-full">
                      <Clock className="w-3 h-3" />
                      Repeat
                    </span>
                  )}
                  {!list.is_repeatable && totalCount === 0 && (
                    <span className="text-xs text-gray-400">Empty list</span>
                  )}
                  <span className="text-xs text-gray-400 ml-auto">
                    {formatDate(list.updated_at)}
                  </span>
                </div>
              </Link>
            )
          })}
        </div>
      ) : activeType !== 'all' ? (
        /* Empty state for specific type filter */
        <div className="text-center py-16">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <List className="w-7 h-7 text-gray-300" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No {activeType} lists</h3>
          <p className="text-gray-500 mb-6">
            Create your first {activeType} list to get started
          </p>
          <Link
            href="/dashboard/lists/create"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-xl hover:bg-gray-800 transition-colors"
          >
            <PlusCircle className="w-4 h-4" />
            Create List
          </Link>
        </div>
      ) : null}

      {/* Only show this when there are no lists at all (all types) */}
    </div>
  )
}
