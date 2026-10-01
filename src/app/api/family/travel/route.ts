import { NextResponse } from 'next/server'
import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { featureGate } from '@/lib/feature-gate-server'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'
import { updateTravelSchema } from '@/lib/validations'

type SessionUser = { id: string; email: string; role?: string; family_id?: string | null }

export async function GET() {
  const user = (await getServerUser()) as SessionUser | null
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!user.family_id) {
    return NextResponse.json({ error: 'No family' }, { status: 400 })
  }

  const gate = await featureGate(user.family_id, 'travel')
  if (gate) return gate
  // When the household is away and where it went is parent-only (#102). The
  // travel page is not on the kid allowlist, so no kid surface reads this.
  if (user.role !== 'parent') {
    return NextResponse.json({ error: 'Parents only' }, { status: 403 })
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

// PATCH - Update travel mode (parents only). Dates are date-only: `YYYY-MM-DD`
// (a full ISO date-time from older clients keeps its UTC calendar day), stored
// as UTC midnight of that day; "" or null clears. Malformed input is a 400.
export async function PATCH(request: Request) {
  try {
    const user = (await getServerUser()) as SessionUser | null
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const gate = await featureGate(user.family_id, 'travel')
    if (gate) return gate
    if (user.role !== 'parent') {
      return NextResponse.json({ error: 'Parents only' }, { status: 403 })
    }
    if (!user.family_id) {
      return NextResponse.json({ error: 'No family' }, { status: 400 })
    }

    let json: unknown
    try {
      json = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const parsed = updateTravelSchema.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }
    const { travel_mode_active, travel_start_date, travel_end_date, travel_destination } = parsed.data

    const updated = await prisma!.family.update({
      where: { id: user.family_id },
      data: {
        ...(travel_mode_active !== undefined && { travel_mode_active }),
        ...(travel_start_date !== undefined && { travel_start_date }),
        ...(travel_end_date !== undefined && { travel_end_date }),
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
  } catch (error) {
    logRouteError('PATCH /api/family/travel', error, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
