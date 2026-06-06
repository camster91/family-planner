import { NextResponse } from 'next/server'
import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'

type SessionUser = { id: string; email: string; role?: string; family_id?: string | null }

export async function GET() {
  const user = (await getServerUser()) as SessionUser | null
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!user.family_id) return NextResponse.json({ items: [] })

  const items = await prisma!.allowance.findMany({
    where: { family_id: user.family_id },
    include: {
      from_user: { select: { id: true, name: true } },
      to_user: { select: { id: true, name: true, avatar_url: true } },
    },
    orderBy: [{ status: 'asc' }, { created_at: 'desc' }],
    take: 100,
  })

  return NextResponse.json({
    items: items.map((a) => ({
      id: a.id,
      amount: a.amount,
      reason: a.reason,
      status: a.status as 'pending' | 'paid' | 'cancelled',
      scheduled_for: a.scheduled_for?.toISOString() || null,
      paid_at: a.paid_at?.toISOString() || null,
      from_user_id: a.from_user_id,
      to_user_id: a.to_user_id,
      from_name: a.from_user.name,
      to_name: a.to_user.name,
      to_avatar: a.to_user.avatar_url,
      created_at: a.created_at.toISOString(),
    })),
  })
}

export async function POST(request: Request) {
  const user = (await getServerUser()) as SessionUser | null
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!user.family_id) return NextResponse.json({ error: 'No family' }, { status: 400 })
  if (user.role !== 'parent') {
    return NextResponse.json({ error: 'Only parents can create allowance' }, { status: 403 })
  }

  let body: { to_user_id?: string; amount?: number; reason?: string | null }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!body.to_user_id || typeof body.amount !== 'number' || body.amount <= 0) {
    return NextResponse.json({ error: 'to_user_id and positive amount required' }, { status: 400 })
  }

  // Verify the target user is in the same family
  const target = await prisma!.user.findUnique({
    where: { id: body.to_user_id },
    select: { family_id: true },
  })
  if (!target || target.family_id !== user.family_id) {
    return NextResponse.json({ error: 'Target user not in your family' }, { status: 400 })
  }

  const created = await prisma!.allowance.create({
    data: {
      family_id: user.family_id,
      from_user_id: user.id,
      to_user_id: body.to_user_id,
      amount: body.amount,
      reason: body.reason?.trim() || null,
    },
  })
  return NextResponse.json({ allowance: created }, { status: 201 })
}
