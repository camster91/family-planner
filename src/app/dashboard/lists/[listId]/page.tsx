import { Suspense } from 'react'
import { ArrowLeft, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import ListDetailClient from './ListDetailClient'
import type { ListType } from '@/types'

export const dynamic = 'force-dynamic'

export default async function ListDetailPage({ params }: { params: Promise<{ listId: string }> }) {
  const resolvedParams = await params
  const sessionUser = await getServerUser()

  if (!sessionUser) return null

  const user = await prisma!.user.findUnique({
    where: { id: sessionUser.id },
    include: { family: true },
  })
  if (!user) return null

  let list: any = null
  let items: any[] = []

  try {
    list = await (prisma as any).list.findUnique({
      where: { id: resolvedParams.listId },
      include: { creator: { select: { name: true, avatar_url: true } } },
    })
    if (list) {
      items = await (prisma as any).list_item.findMany({
        where: { list_id: resolvedParams.listId },
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
    added_by: item.added_by_user ?? { name: 'Unknown' },
    checked_by: item.checked_by_user ?? undefined,
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
        <DeleteListButton listId={list.id} listName={list.name} />
      </div>

      <ListDetailClient
        listId={list.id}
        listName={list.name}
        listType={list.type as ListType}
        items={mappedItems}
        userId={user.id}
      />
    </div>
  )
}

// Inline delete button (replaces DeleteListButton component)
function DeleteListButton({ listId, listName }: { listId: string; listName: string }) {
  'use client'
  const [deleting, setDeleting] = useState(false)
  const router = useRouter()

  const handleDelete = async () => {
    if (!confirm(`Delete "${listName}"?`)) return
    setDeleting(true)
    try {
      // Get CSRF token from cookie
      const csrfMatch = document.cookie.split('; ').find(c => c.startsWith('csrf_token='))
      const csrf = csrfMatch ? csrfMatch.split('=')[1] : ''

      const res = await fetch('/api/lists', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({ listId }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(`Failed to delete: ${data.error || res.statusText}`)
        return
      }
      router.push('/dashboard/lists')
      router.refresh()
    } catch (err) {
      alert('Network error')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={deleting}
      className="p-2 text-label-tertiary active:text-[var(--tint-rewards)] rounded-lg active:bg-[var(--surface-fill)] disabled:opacity-50"
      aria-label={`Delete list ${listName}`}
    >
      <Trash2 className="w-4 h-4" />
    </button>
  )
}