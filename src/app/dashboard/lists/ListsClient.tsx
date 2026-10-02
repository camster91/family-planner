'use client'

import * as React from 'react'
import { ShoppingCart, CheckSquare, UtensilsCrossed, Heart, ShoppingBag, List, LucideIcon } from 'lucide-react'
import { Plus } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Glyph } from '@/components/ui/glyph'
import { InsetList, ListRow, SectionHeader } from '@/components/ui/list-row'
import { EmptyState } from '@/components/ui/empty-state'
import { LargeHeader } from '@/components/ui/large-header'
import { listTypeFilter, listsFilterHref, type ListTypeKey } from '@/lib/list-type-filter'

// -----------------------------------------------------------------------
// Type config
// -----------------------------------------------------------------------

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
  /** D9 (#102): parents and teens may create lists; a child may not. */
  canCreate?: boolean
  /** `?type=` from the URL (route inventory F-6): show only lists of this type. */
  initialType?: string | null
}

// -----------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------

export default function ListsClient({ lists, familyName, canCreate = true, initialType = null }: ListsClientProps) {
  const router = useRouter()
  // The type cards filter this page (route inventory F-6); the old
  // /dashboard/lists/type/[type] pages redirect here with `?type=`.
  const [typeFilter, setTypeFilter] = React.useState<ListTypeKey | null>(() => listTypeFilter(initialType))
  const applyFilter = (next: ListTypeKey | null) => {
    setTypeFilter(next)
    router.replace(listsFilterHref(next), { scroll: false })
  }
  const shown = typeFilter ? lists.filter(l => l.type === typeFilter) : lists
  const filterCfg = typeFilter ? TYPE_CONFIG[typeFilter] : null
  // ADR-0007 O-8: no new 'meal_plan' lists (existing ones stay readable).
  const createHref =
    typeFilter && typeFilter !== 'meal_plan' ? `/dashboard/lists/create?type=${typeFilter}` : '/dashboard/lists/create'
  const canCreateHere = canCreate && typeFilter !== 'meal_plan'

  // Main type cards at the top. 'meal_plan' is no longer a list type people
  // create (ADR-0007 O-8; meals live in /dashboard/meals), so its card shows
  // only while the household still has such lists, which keep opening as before.
  const hasMealPlanLists = lists.some(l => l.type === 'meal_plan')
  const mainTypes: ListTypeKey[] = hasMealPlanLists
    ? ['grocery', 'todo', 'meal_plan', 'wishlist']
    : ['grocery', 'todo', 'wishlist']

  return (
    <div className="pb-20">
      <LargeHeader
        greeting={familyName}
        title="Lists"
        trailing={
          canCreate ? (
            <Link href={createHref} className="btn-tinted" aria-label="Add list">
              <Plus className="w-4 h-4" />
            </Link>
          ) : undefined
        }
        className="px-4"
      />

      <div className="space-y-6 px-4">
        {/* Type cards: each one filters the lists below (pressed again, shows all). */}
        <section aria-label="Filter by type">
          <div className="grid grid-cols-2 gap-3">
            {mainTypes.map((type) => {
              const cfg = TYPE_CONFIG[type]
              const Icon = ICONS[type]
              const count = lists.filter(l => l.type === type).length
              const pressed = typeFilter === type
              return (
                <button
                  key={type}
                  type="button"
                  aria-pressed={pressed}
                  onClick={() => applyFilter(pressed ? null : type)}
                  className={
                    'card-apple p-4 min-h-[44px] flex flex-col items-center gap-2 text-center active:scale-95 motion-reduce:active:scale-100 transition-transform focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-text)]' +
                    (pressed ? ' ring-2 ring-[var(--accent)]' : '')
                  }
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

        {/* All lists, or the lists of the chosen type */}
        {filterCfg && (
          <div className="flex items-center justify-between gap-3">
            <p className="text-subhead text-label-secondary" role="status">
              Showing {filterCfg.name.toLowerCase()} lists only
            </p>
            <button
              type="button"
              onClick={() => applyFilter(null)}
              className="inline-flex min-h-[44px] items-center rounded-full bg-[var(--surface-fill)] px-4 text-[15px] font-medium text-label-primary focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-text)]"
            >
              Show all lists
            </button>
          </div>
        )}
        {shown.length > 0 ? (
          <section>
            <SectionHeader>{filterCfg ? `${filterCfg.name} Lists` : 'All Lists'}</SectionHeader>
            <InsetList>
              {shown.map((list, i) => {
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
                    last={i === shown.length - 1}
                  />
                )
              })}
            </InsetList>
          </section>
        ) : (
          <EmptyState
            icon={typeFilter ? ICONS[typeFilter] : List}
            glyphColor={filterCfg ? filterCfg.color : 'lists'}
            title={filterCfg ? `No ${filterCfg.name.toLowerCase()} lists` : 'No lists yet'}
            description={
              typeFilter === 'meal_plan'
                ? 'Meals are planned in Meals now.'
                : canCreate
                  ? filterCfg
                    ? `Create your first ${filterCfg.name.toLowerCase()} list.`
                    : 'Create your first shared list for the family.'
                  : 'Ask a parent to create a new list.'
            }
            action={
              canCreateHere ? (
                <Link href={createHref} className="btn-filled">
                  <Plus className="w-4 h-4" />
                  <span>Create List</span>
                </Link>
              ) : undefined
            }
          />
        )}
      </div>
    </div>
  )
}