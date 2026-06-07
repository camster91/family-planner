import { Suspense } from 'react'
import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import ListsClient from './ListsClient'

export const dynamic = 'force-dynamic'

export default async function ListsPage() {
  const sessionUser = await getServerUser()
  if (!sessionUser) return null

  const user = await prisma!.user.findUnique({
    where: { id: sessionUser.id },
    select: {
      family_id: true,
      family: { select: { name: true } },
    },
  })
  if (!user?.family_id) return null

  let lists: any[] = []
  try {
    lists = await prisma!.list.findMany({
      where: { family_id: user.family_id },
      include: {
        _count: { select: { items: true } },
        items: { select: { checked: true } },
        creator: { select: { name: true } },
      },
      orderBy: { updated_at: 'desc' },
    })
  } catch (error) {
    console.warn('Error fetching lists:', error)
  }

  const listsWithCounts = lists.map((list: any) => ({
    id: list.id,
    name: list.name,
    type: list.type,
    description: list.description,
    updated_at: list.updated_at,
    creator: list.creator,
    _count: list._count,
    checked_count: (list.items || []).filter((i: any) => i.checked).length,
    total_count: list._count?.items || 0,
  }))

  return (
    <ListsClient
      lists={listsWithCounts}
      familyName={user.family?.name || 'Family'}
    />
  )
}