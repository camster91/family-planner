'use client'

import * as React from 'react'
import { ShoppingCart, CheckSquare, UtensilsCrossed, Heart, ShoppingBag, List, LucideIcon } from 'lucide-react'
import { Plus } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Glyph } from '@/components/ui/glyph'
import { InsetList, ListRow, SectionHeader } from '@/components/ui/list-row'
import { EmptyState } from '@/components/ui/empty-state'
import { LargeHeader } from '@/components/ui/large-header'

// -----------------------------------------------------------------------
// Type config
// -----------------------------------------------------------------------

type ListTypeKey = 'grocery' | 'todo' | 'meal_plan' | 'wishlist' | 'shopping'

interface TypeConfig {
  name: string
  color: 'lists' | 'rewards' | 'meals' | 'family'
}

const TYPE_CONFIG: Record<string, TypeConfig> = {
  grocery: { name: 'Shopping', color: 'lists' },
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
// Props
// -----------------------------------------------------------------------

interface ListSummary {
  id: string
  name: string
  type: string
  creator: { name: string }
  checked_count: number
  total_count: number
}

interface ListsClientProps {
  lists: ListSummary[]
  familyName: string
}

// -----------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------

export default function ListsClient({ lists, familyName }: ListsClientProps) {
  const router = useRouter()

  // 4 main type cards to show at the top
  const mainTypes: ListTypeKey[] = ['grocery', 'todo', 'meal_plan', 'wishlist']

  return (
    <div className="pb-20">
      <LargeHeader
        greeting="Family"
        title={familyName}
        subtitle="Shared Lists"
        trailing={
          <Link href="/dashboard/lists/create" className="btn-tinted">
            <Plus className="w-4 h-4" />
          </Link>
        }
        className="px-4"
      />

      <div className="space-y-6 px-4">
        {/* 4 type glyph cards */}
        <section>
          <div className="grid grid-cols-2 gap-3">
            {mainTypes.map((type) => {
              const cfg = TYPE_CONFIG[type]
              const Icon = ICONS[type]
              const count = lists.filter(l => l.type === type).length
              return (
                <button
                  key={type}
                  onClick={() => router.push(`/dashboard/lists/type/${type}`)}
                  className="card-apple p-4 flex flex-col items-center gap-2 text-center active:scale-95 transition-transform"
                >
                  <Glyph color={cfg.color} size="lg">
                    <Icon className="w-6 h-6 text-white" />
                  </Glyph>
                  <span className="text-subhead text-label-primary font-medium">{cfg.name}</span>
                  {count > 0 && (
                    <span className="text-caption-1 text-label-tertiary">{count} list{count !== 1 ? 's' : ''}</span>
                  )}
                </button>
              )
            })}
          </div>
        </section>

        {/* All lists */}
        {lists.length > 0 ? (
          <section>
            <SectionHeader>All Lists</SectionHeader>
            <InsetList>
              {lists.map((list, i) => {
                const cfg = TYPE_CONFIG[list.type] || TYPE_CONFIG.grocery
                const Icon = ICONS[list.type] || ShoppingCart
                return (
                  <ListRow
                    key={list.id}
                    href={`/dashboard/lists/${list.id}`}
                    icon={Icon}
                    glyphColor={cfg.color}
                    title={list.name}
                    subtitle={list.creator.name}
                    trailing={
                      list.total_count > 0 ? (
                        <span className="text-footnote text-label-tertiary">
                          {list.checked_count}/{list.total_count}
                        </span>
                      ) : undefined
                    }
                    last={i === lists.length - 1}
                  />
                )
              })}
            </InsetList>
          </section>
        ) : (
          <EmptyState
            icon={List}
            glyphColor="lists"
            title="No lists yet"
            description="Create your first shared list for the family."
            action={
              <Link href="/dashboard/lists/create" className="btn-filled">
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