import { Suspense } from 'react'
import { ArrowLeft, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import ListDetailClient from './ListDetailClient'
import DeleteListButton from './DeleteListButton'
import { PersonGroceryAdd } from './PersonGroceryAdd'
import type { ListType } from '@/types'
import { canChangeListSectionSort, canDeleteListOrItem } from '@/lib/role-capabilities'
import { isGroceryListType } from '@/lib/grocery-display'
import {
  SECTION_INGREDIENT_SELECT,
  loadSectionOrder,
  loadSectionOverrides,
  sectionsFor,
} from '@/lib/grocery-section-store'
import { GROCERY_SECTIONS, type GrocerySectionId } from '@/lib/grocery-sections'

export const dynamic = 'force-dynamic'

export default async function ListDetailPage({ params }: { params: Promise<{ listId: string }> }) {
  const resolvedParams = await params
  const sessionUser = await getServerUser()

  if (!sessionUser) return null

  const user = await prisma!.user.findUnique({
    where: { id: sessionUser.id },
    select: { id: true, family_id: true },
  })
  if (!user) return null
  // D9 (#102): every member may add and tick items; deleting a list or an
  // item is parent-only (the API enforces it; the page hides the controls).
  const canDelete = canDeleteListOrItem(sessionUser.role)

  let list: any = null
  let items: any[] = []
  // Store sections (#273): resolved server-side and delivered with the page,
  // so grouping works offline on the client.
  let sections: GrocerySectionId[] = []
  let sectionOverrides: Record<string, GrocerySectionId> = {}
  let sectionOrder: { order: GrocerySectionId[]; learned: boolean } = { order: [...GROCERY_SECTIONS], learned: false }

  try {
    // Scope by household: an id from another family must read as "not found"
    // (found by the #155 cross-family E2E journey).
    list = user.family_id
      ? await (prisma as any).list.findFirst({
          where: { id: resolvedParams.listId, family_id: user.family_id },
          include: { creator: { select: { name: true, avatar_url: true } } },
        })
      : null
    if (list) {
      items = await prisma!.listItem.findMany({
        where: { list_id: list.id },
        include: {
          adder: { select: { name: true, avatar_url: true } },
          checker: { select: { name: true } },
          // Grocery provenance (ADR-0007): names only, household-owned through the list.
          recipe: { select: { title: true } },
          ingredient: SECTION_INGREDIENT_SELECT,
        },
        orderBy: { position: 'asc' },
      })
      if (isGroceryListType(list.type)) {
        sectionOverrides = await loadSectionOverrides(prisma!, list.family_id, items)
        sections = sectionsFor(items, sectionOverrides)
        sectionOrder = await loadSectionOrder(prisma!, list.family_id)
      }
    }
  } catch (error) {
    console.error('Error fetching list:', error)
  }

  if (!list) {
    return (
      <div className="max-w-4xl mx-auto px-4 pb-20">
        <Link href="/dashboard/lists" className="inline-flex items-center text-subhead text-[var(--accent)] mb-8">
          <ArrowLeft className="w-4 h-4 mr-1" />
          Back
        </Link>
        <div className="card-apple p-8 text-center">
          <h1 className="text-title-3 text-label-primary">List not found</h1>
        </div>
        <div className="mt-4"><PersonGroceryAdd userId={user.id} listId={resolvedParams.listId} allowNew={false} /></div>
      </div>
    )
  }

  const mappedItems = items.map((item: any, i: number) => ({
    id: item.id,
    content: item.content,
    checked: item.checked,
    quantity: item.quantity ?? 1,
    category: item.category ?? null,
    added_by: item.adder ?? { name: 'Unknown' },
    checked_by: item.checker ?? undefined,
    checked_at: item.checked_at ?? undefined,
    amount: item.amount ?? null,
    unit: item.unit ?? null,
    ingredient_id: item.ingredient_id ?? null,
    ingredient_name: item.ingredient?.name ?? null,
    recipe_title: item.recipe?.title ?? null,
    section: sections[i] ?? null,
  }))

  return (
    <div className="max-w-2xl mx-auto">
      {/* Nav */}
      <div className="flex items-center justify-between px-4 pt-4 mb-4">
        <Link href="/dashboard/lists" className="inline-flex items-center gap-1 text-subhead text-[var(--accent)]">
          <ArrowLeft className="w-4 h-4" />
          <span>Lists</span>
        </Link>
        {canDelete && <DeleteListButton listId={list.id} listName={list.name} />}
      </div>

      <ListDetailClient
        listId={list.id}
        listName={list.name}
        listType={list.type as ListType}
        items={mappedItems}
        userId={user.id}
        canDeleteItems={canDelete}
        sectionSort={{
          enabled: list.sort_by_section !== false,
          order: sectionOrder.order,
          learned: sectionOrder.learned,
          overrides: sectionOverrides,
          canChange: canChangeListSectionSort(sessionUser.role),
        }}
      />
    </div>
  )
}

// Inline delete button moved to ./DeleteListButton.tsx (client component)
