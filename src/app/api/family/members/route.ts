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

  const members = await prisma!.user.findMany({
    where: { family_id: user.family_id },
    select: { id: true, name: true, avatar_url: true, role: true },
    orderBy: { name: 'asc' },
  })
  return NextResponse.json({ members })
}
