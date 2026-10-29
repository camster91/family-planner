import { redirect } from 'next/navigation'
import { getServerActor, getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { storageBackend } from '@/lib/storage-backend'
import { readD1ListIndex } from '@/lib/cloudflare/list-read'
import { parseListPaging } from '@/lib/list-paging'

export const dynamic = 'force-dynamic'
/** Navigate without creating a list or choosing arbitrarily between several. */
export default async function GroceryListDestination() {
  if (storageBackend() === 'd1') {
    const session = await getServerActor()
    if (!session) return null
    if (!session.family_id) return null
    const paging = parseListPaging(
      new URLSearchParams({ limit: '2' }),
      { familyId: session.family_id, type: 'grocery' },
    )
    if (!paging.ok) redirect('/dashboard/lists?type=grocery')
    const result = await readD1ListIndex(
      {
        userId: session.id,
        familyId: session.family_id,
        role: session.role ?? '',
        generation: session.tokenVersion,
      },
      'grocery',
      paging,
    )
    if (result.status === 401) return null
    if (result.status !== 200) redirect('/dashboard/lists?type=grocery')
    const lists = ((result.body as any).lists ?? []) as Array<{ id: string }>
    redirect(lists.length === 1 ? `/dashboard/lists/${encodeURIComponent(lists[0].id)}` : '/dashboard/lists?type=grocery')
  }
  const session = await getServerUser()
  if (!session) return null
  const user = await prisma!.user.findUnique({ where: { id: session.id }, select: { family_id: true } })
  if (!user?.family_id) return null
  const lists = await prisma!.list.findMany({
    where: { family_id: user.family_id, type: 'grocery' },
    select: { id: true }, orderBy: [{ created_at: 'asc' }, { id: 'asc' }], take: 2,
  })
  redirect(lists.length === 1 ? `/dashboard/lists/${encodeURIComponent(lists[0].id)}` : '/dashboard/lists?type=grocery')
}
