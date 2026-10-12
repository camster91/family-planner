import { NextRequest } from 'next/server'
import { getServerUser } from '@/lib/supabase/server'
import { refusePairedDevice } from '@/lib/device-route'
import { prisma } from '@/lib/prisma'
import { featureGate } from '@/lib/feature-gate-server'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'
import { createLocationSchema } from '@/lib/validations'
import { LOCATION_SELECT, locationJson, toLocationResponse, withLocationNoStore } from '../response'

type SessionUser = { id: string; email: string; role?: string; family_id?: string | null }

async function currentParent(user: SessionUser) {
  if (!user.family_id || user.role !== 'parent') return null
  const current = await prisma!.user.findUnique({
    where: { id: user.id },
    select: { family_id: true, role: true },
  })
  return current?.family_id === user.family_id && current.role === 'parent' ? current : null
}

/** Parent-only, family-scoped full replacement for an existing private place. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const deviceRefusal = await refusePairedDevice(request)
    if (deviceRefusal) return withLocationNoStore(deviceRefusal)

    const { id } = await params
    const user = (await getServerUser()) as SessionUser | null
    if (!user) return locationJson({ error: 'Unauthorized' }, 401)
    const gate = await featureGate(user.family_id, 'locations')
    if (gate) return withLocationNoStore(gate)
    if (!user.family_id) return locationJson({ error: 'No family' }, 400)
    if (user.role !== 'parent') {
      return locationJson({ error: 'Only parents can update locations' }, 403)
    }
    if (!(await currentParent(user))) return locationJson({ error: 'Only parents can update locations' }, 403)

    const existing = await prisma!.familyLocation.findUnique({
      where: { id },
      select: { family_id: true },
    })
    if (!existing || existing.family_id !== user.family_id) {
      return locationJson({ error: 'Not found' }, 404)
    }

    let json: unknown
    try {
      json = await request.json()
    } catch {
      return locationJson({ error: 'Invalid JSON' }, 400)
    }
    const parsed = createLocationSchema.safeParse(json)
    if (!parsed.success) {
      return locationJson({ error: parsed.error.issues[0].message }, 400)
    }
    const { label, address } = parsed.data
    const changed = await prisma!.familyLocation.updateMany({
      where: { id, family_id: user.family_id },
      data: {
        label,
        address: address?.trim() || null,
        is_primary: label.toLowerCase() === 'home',
      },
    })
    if (changed.count !== 1) return locationJson({ error: 'Not found' }, 404)
    const updated = await prisma!.familyLocation.findUnique({ where: { id }, select: LOCATION_SELECT })
    if (!updated) return locationJson({ error: 'Not found' }, 404)
    return locationJson({ location: toLocationResponse(updated) })
  } catch (error) {
    logRouteError('PATCH /api/locations/[id]', error, getRequestId(request))
    return locationJson({ error: 'Internal server error' }, 500)
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const deviceRefusal = await refusePairedDevice(_request)
  if (deviceRefusal) return withLocationNoStore(deviceRefusal)

  const { id } = await params
  const user = (await getServerUser()) as SessionUser | null
  if (!user) return locationJson({ error: 'Unauthorized' }, 401)
  const gate = await featureGate(user.family_id, 'locations')
  if (gate) return withLocationNoStore(gate)
  if (!user.family_id) return locationJson({ error: 'No family' }, 400)
  if (user.role !== 'parent') {
    return locationJson({ error: 'Only parents can delete locations' }, 403)
  }
  if (!(await currentParent(user))) return locationJson({ error: 'Only parents can delete locations' }, 403)

  // Ensure the location belongs to the caller's family
  const existing = await prisma!.familyLocation.findUnique({
    where: { id },
    select: { family_id: true },
  })
  if (!existing || existing.family_id !== user.family_id) {
    return locationJson({ error: 'Not found' }, 404)
  }

  const deleted = await prisma!.familyLocation.deleteMany({ where: { id, family_id: user.family_id } })
  if (deleted.count !== 1) return locationJson({ error: 'Not found' }, 404)
  return locationJson({ ok: true })
}
