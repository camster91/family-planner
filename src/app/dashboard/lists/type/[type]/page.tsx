import { Suspense } from 'react'
import { Plus, ShoppingCart, CheckSquare, UtensilsCrossed, Heart, ShoppingBag, List, LucideIcon } from 'lucide-react'
import Link from 'next/link'
import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { InsetList, ListRow, SectionHeader } from '@/components/ui/list-row'
import { Glyph } from '@/components/ui/glyph'
import { EmptyState } from '@/components/ui/empty-state'
import { LargeHeader } from '@/components/ui/large-header'
import type { ListType } from '@/types'

export const dynamic = 'force-dynamic'

// -----------------------------------------------------------------------
// Type config
// -----------------------------------------------------------------------

type ListTypeKey = 'grocery' | 'todo' | 'meal_plan' | 'wishlist' | 'shopping'

interface TypeConfig {
  name: string
  color: 'lists' | 'rewards' | 'meals' | 'family'
}

const TYPE_CONFIG: Record<string, TypeConfig> = {
  grocery: { name: 'Grocery', color: 'lists' },
  todo: { name: 'To-dos', color: 'rewards' },
  meal_plan: { name: 'Meal plan', color: 'meals' },
  wishlist: { name: 'Wishlist', color: 'family' },
  shopping: { name: 'Shopping', color: 'lists' },
}

const ICONS: Record<string, LucideIcon> = {
  grocery: ShoppingCart,
  todo: CheckSquare,
  meal_plan: UtensilsCrossed,
  wishlist: Heart,
  shopping: ShoppingBag,
}

// -----------------------------------------------------------------------
// Page
// -----------------------------------------------------------------------

export default async function ListsByTypePage({ params }: { params: Promise<{ type: string }> }) {
  const resolvedParams = await params
  const type = resolvedParams.type as ListTypeKey

  const sessionUser = await getServerUser()
  if (!sessionUser) return null

  const user = await prisma!.user.findUnique({
    where: { id: sessionUser.id },
    include: { family: true },
  })
  if (!user) return null

  const typeConfig = TYPE_CONFIG[type]
  if (!typeConfig) {
    return (
      <div className="max-w-2xl mx-auto px-4 pb-20">
        <Link href="/dashboard/lists" className="inline-flex items-center text-subhead text-[var(--accent)]">
          ← Back
        </Link>
        <div className="card-apple p-8 text-center mt-8">
          <p className="text-title-3 text-label-primary">Unknown type</p>
        </div>
      </div>
    )
  }

  const Icon = ICONS[type]

  let lists: any[] = []
  try {
    lists = await (prisma as any).list.findMany({
      where: { family_id: user.family_id, type },
      include: {
        items: { select: { checked: true } },
        creator: { select: { name: true } },
      },
      orderBy: { updated_at: 'desc' },
    })
  } catch (error) {
    console.warn('Error fetching lists:', error)
  }

  const listItems = lists.map((list: any) => ({
    id: list.id,
    name: list.name,
    type: list.type,
    description: list.description,
    creator: list.creator,
    checked_count: (list.items || []).filter((i: any) => i.checked).length,
    total_count: list.items?.length || 0,
  }))

  return (
    <div className="pb-20">
      <LargeHeader
        greeting="Family"
        title={typeConfig.name}
        trailing={
          <Link href={`/dashboard/lists/create?type=${type}`} className="btn-tinted">
            <Plus className="w-4 h-4" />
          </Link>
        }
        className="px-4"
      />

      <div className="px-4 space-y-5">
        {/* Stats row */}
        <div className="card-apple p-4 flex items-center gap-4">
          <Glyph color={typeConfig.color} size="lg">
            <Icon className="w-6 h-6 text-white" />
          </Glyph>
          <div className="flex-1 min-w-0">
            <p className="text-body text-label-primary font-medium">{typeConfig.name}</p>
            <p className="text-footnote text-label-secondary">
              {lists.length} list{lists.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>

        {/* Lists */}
        {listItems.length > 0 ? (
          <section>
            <SectionHeader>All {typeConfig.name} Lists</SectionHeader>
            <InsetList>
              {listItems.map((list, i) => (
                <ListRow
                  key={list.id}
                  href={`/dashboard/lists/${list.id}`}
                  icon={Icon}
                  glyphColor={typeConfig.color}
                  title={list.name}
                  subtitle={list.creator.name}
                  trailing={
                    list.total_count > 0 ? (
                      <span className="text-footnote text-label-tertiary">
                        {list.checked_count}/{list.total_count}
                      </span>
                    ) : undefined
                  }
                  last={i === listItems.length - 1}
                />
              ))}
            </InsetList>
          </section>
        ) : (
          <EmptyState
            icon={Icon}
            glyphColor={typeConfig.color}
            title={`No ${typeConfig.name} lists`}
            description={`Create your first ${typeConfig.name.toLowerCase()} list.`}
            action={
              <Link href={`/dashboard/lists/create?type=${type}`} className="btn-filled">
                <Plus className="w-4 h-4" />
                <span>Create List</span>
              </Link>
            }
          />
        )}
      </div>
    </div>
  )
}