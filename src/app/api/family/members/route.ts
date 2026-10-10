import { NextResponse } from 'next/server'
import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'

type SessionUser = { id: string; email: string; role?: string; family_id?: string | null }

/**
 * GET /api/family/members
 * Returns basic info about the user's family members.
 * Used by feature pages that need an assignee selector (pickups, allowance).
 */
export async function GET() {
  const user = (await getServerUser()) as SessionUser | null
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!user.family_id) return NextResponse.json({ members: [] })

  // Email addresses are useful on the parent-only Family page, but this
  // endpoint is also used by kid-accessible selectors (sick days and meals).
  // Keep the shared member response name-only for teens/children.
  const select = {
    id: true,
    name: true,
    avatar_url: true,
    role: true,
    ...(user.role === 'parent' ? { email: true } : {}),
  } as const

  const members = await prisma!.user.findMany({
    where: { family_id: user.family_id },
    select,
    orderBy: { name: 'asc' },
  })
  return NextResponse.json({ members })
}
