import { NextResponse } from 'next/server'
import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { featureGate } from '@/lib/feature-gate-server'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'
import { createLocationSchema } from '@/lib/validations'

type SessionUser = { id: string; email: string; role?: string; family_id?: string | null }

export async function GET() {
  const user = (await getServerUser()) as SessionUser | null
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await featureGate(user.family_id, 'locations')
  if (gate) return gate
  if (!user.family_id) return NextResponse.json({ locations: [] })
  // Saved places carry precise addresses, which are parent-only (#102,
  // AUTHORIZATION.md). The kid dashboard has no locations surface.
  if (user.role !== 'parent') {
    return NextResponse.json({ error: 'Only parents can view locations' }, { status: 403 })
  }

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
  try {
    const user = (await getServerUser()) as SessionUser | null
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const gate = await featureGate(user.family_id, 'locations')
    if (gate) return gate
    if (!user.family_id) return NextResponse.json({ error: 'No family' }, { status: 400 })
    if (user.role !== 'parent') {
      return NextResponse.json({ error: 'Only parents can add locations' }, { status: 403 })
    }

    let json: unknown
    try {
      json = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const parsed = createLocationSchema.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }
    const { label, address } = parsed.data

    const created = await prisma!.familyLocation.create({
      data: {
        family_id: user.family_id,
        user_id: user.id,
        label,
        address: address?.trim() || null,
        is_primary: label.toLowerCase() === 'home',
      },
    })
    return NextResponse.json({ location: created }, { status: 201 })
  } catch (error) {
    logRouteError('POST /api/locations', error, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
