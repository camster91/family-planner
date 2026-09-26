import { Suspense } from 'react'
import { ArrowLeft, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import ListDetailClient from './ListDetailClient'
import DeleteListButton from './DeleteListButton'
import type { ListType } from '@/types'
import { canDeleteListOrItem } from '@/lib/role-capabilities'

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
        },
        orderBy: { position: 'asc' },
      })
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
          <p className="text-title-3 text-label-primary">List not found</p>
        </div>
      </div>
    )
  }

  const mappedItems = items.map((item: any) => ({
    id: item.id,
    content: item.content,
    checked: item.checked,
    quantity: item.quantity ?? 1,
    category: item.category ?? null,
    added_by: item.adder ?? { name: 'Unknown' },
    checked_by: item.checker ?? undefined,
    checked_at: item.checked_at ?? undefined,
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
      />
    </div>
  )
}

// Inline delete button moved to ./DeleteListButton.tsx (client component)