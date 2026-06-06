import { NextResponse } from 'next/server'
import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'

type SessionUser = { id: string; email: string; role?: string; family_id?: string | null }

export async function GET() {
  const user = (await getServerUser()) as SessionUser | null
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!user.family_id) return NextResponse.json({ pickups: [] })

  const pickups = await prisma!.pickup.findMany({
    where: { family_id: user.family_id },
    include: { assignee: { select: { id: true, name: true, avatar_url: true } } },
    orderBy: { pickup_time: 'asc' },
  })

  return NextResponse.json({
    pickups: pickups.map((p) => ({
      id: p.id,
      title: p.title,
      location: p.location,
      pickup_time: p.pickup_time.toISOString(),
      completed: p.completed,
      completed_at: p.completed_at?.toISOString() || null,
      assigned_to: p.assigned_to,
      assignee_name: p.assignee?.name,
      assignee_avatar: p.assignee?.avatar_url,
      notes: p.notes,
    })),
  })
}

export async function POST(request: Request) {
  const user = (await getServerUser()) as SessionUser | null
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!user.family_id) return NextResponse.json({ error: 'No family' }, { status: 400 })

  let body: { title?: string; location?: string | null; pickup_time?: string; assigned_to?: string | null; notes?: string | null }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!body.title || !body.pickup_time) {
    return NextResponse.json({ error: 'title and pickup_time required' }, { status: 400 })
  }

  const created = await prisma!.pickup.create({
    data: {
      family_id: user.family_id,
      created_by: user.id,
      title: body.title.trim(),
      location: body.location?.trim() || null,
      pickup_time: new Date(body.pickup_time),
      assigned_to: body.assigned_to || null,
      notes: body.notes?.trim() || null,
    },
  })
  return NextResponse.json({ pickup: created }, { status: 201 })
}
