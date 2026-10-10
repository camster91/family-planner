import { redirect } from 'next/navigation'
import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
/** Navigate without creating a list or choosing arbitrarily between several. */
export default async function GroceryListDestination() {
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
