import { NextResponse } from 'next/server'
import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'

type SessionUser = { id: string; email: string; role?: string; family_id?: string | null }

export async function GET() {
  const user = (await getServerUser()) as SessionUser | null
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!user.family_id) return NextResponse.json({ locations: [] })

  const locations = await prisma!.familyLocation.findMany({
    where: { family_id: user.family_id },
    include: { user: { select: { id: true, name: true, avatar_url: true } } },
    orderBy: [{ is_primary: 'desc' }, { label: 'asc' }],
  })

  return NextResponse.json({
    locations: locations.map((l) => ({
      id: l.id,
      label: l.label,
      address: l.address,
      is_primary: l.is_primary,
      user_id: l.user_id,
      user_name: l.user.name,
      user_avatar: l.user.avatar_url,
    })),
  })
}

export async function POST(request: Request) {
  const user = (await getServerUser()) as SessionUser | null
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!user.family_id) return NextResponse.json({ error: 'No family' }, { status: 400 })
  if (user.role !== 'parent') {
    return NextResponse.json({ error: 'Only parents can add locations' }, { status: 403 })
  }

  let body: { label?: string; address?: string | null }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!body.label) return NextResponse.json({ error: 'label required' }, { status: 400 })

  const created = await prisma!.familyLocation.create({
    data: {
      family_id: user.family_id,
      user_id: user.id,
      label: body.label.trim(),
      address: body.address?.trim() || null,
      is_primary: body.label.trim().toLowerCase() === 'home',
    },
  })
  return NextResponse.json({ location: created }, { status: 201 })
}
