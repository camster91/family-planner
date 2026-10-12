import { NextRequest, NextResponse } from 'next/server'
import { getServerUser } from '@/lib/supabase/server'
import { refusePairedDevice } from '@/lib/device-route'
import { prisma } from '@/lib/prisma'
import { featureGate } from '@/lib/feature-gate-server'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'
import { createLocationSchema } from '@/lib/validations'

type SessionUser = { id: string; email: string; role?: string; family_id?: string | null }

/** Parent-only, family-scoped full replacement for an existing private place. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const deviceRefusal = await refusePairedDevice(request)
    if (deviceRefusal) return deviceRefusal

    const { id } = await params
    const user = (await getServerUser()) as SessionUser | null
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const gate = await featureGate(user.family_id, 'locations')
    if (gate) return gate
    if (!user.family_id) return NextResponse.json({ error: 'No family' }, { status: 400 })
    if (user.role !== 'parent') {
      return NextResponse.json({ error: 'Only parents can update locations' }, { status: 403 })
    }

    const existing = await prisma!.familyLocation.findUnique({
      where: { id },
      select: { family_id: true },
    })
    if (!existing || existing.family_id !== user.family_id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
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
    const updated = await prisma!.familyLocation.update({
      where: { id },
      data: {
        label,
        address: address?.trim() || null,
        is_primary: label.toLowerCase() === 'home',
      },
    })
    return NextResponse.json({ location: updated })
  } catch (error) {
    logRouteError('PATCH /api/locations/[id]', error, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const deviceRefusal = await refusePairedDevice(_request)
  if (deviceRefusal) return deviceRefusal

  const { id } = await params
  const user = (await getServerUser()) as SessionUser | null
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await featureGate(user.family_id, 'locations')
  if (gate) return gate
  if (!user.family_id) return NextResponse.json({ error: 'No family' }, { status: 400 })
  if (user.role !== 'parent') {
    return NextResponse.json({ error: 'Only parents can delete locations' }, { status: 403 })
  }

  // Ensure the location belongs to the caller's family
  const existing = await prisma!.familyLocation.findUnique({
    where: { id },
    select: { family_id: true },
  })
  if (!existing || existing.family_id !== user.family_id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  await prisma!.familyLocation.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
