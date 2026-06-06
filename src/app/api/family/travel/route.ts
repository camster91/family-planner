import { NextResponse } from 'next/server'
import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'

type SessionUser = { id: string; email: string; role?: string; family_id?: string | null }

export async function GET() {
  const user = (await getServerUser()) as SessionUser | null
  if (!user?.family_id) {
    return NextResponse.json({ error: 'No family' }, { status: 400 })
  }

  const family = await prisma!.family.findUnique({
    where: { id: user.family_id },
    select: {
      travel_mode_active: true,
      travel_start_date: true,
      travel_end_date: true,
      travel_destination: true,
    },
  })

  return NextResponse.json(family)
}

export async function PATCH(request: Request) {
  const user = (await getServerUser()) as SessionUser | null
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (user.role !== 'parent') {
    return NextResponse.json({ error: 'Parents only' }, { status: 403 })
  }
  if (!user.family_id) {
    return NextResponse.json({ error: 'No family' }, { status: 400 })
  }

  const body = await request.json()
  const { travel_mode_active, travel_start_date, travel_end_date, travel_destination } = body

  const updated = await prisma!.family.update({
    where: { id: user.family_id },
    data: {
      ...(travel_mode_active !== undefined && { travel_mode_active }),
      ...(travel_start_date !== undefined && { travel_start_date: travel_start_date ? new Date(travel_start_date) : null }),
      ...(travel_end_date !== undefined && { travel_end_date: travel_end_date ? new Date(travel_end_date) : null }),
      ...(travel_destination !== undefined && { travel_destination }),
    },
    select: {
      travel_mode_active: true,
      travel_start_date: true,
      travel_end_date: true,
      travel_destination: true,
    },
  })

  return NextResponse.json(updated)
}