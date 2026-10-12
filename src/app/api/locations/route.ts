import { NextRequest } from 'next/server'
import { getServerUser } from '@/lib/supabase/server'
import { refusePairedDevice } from '@/lib/device-route'
import { prisma } from '@/lib/prisma'
import { featureGate } from '@/lib/feature-gate-server'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'
import { createLocationSchema } from '@/lib/validations'
import { LOCATION_SELECT, locationJson, toLocationResponse, withLocationNoStore } from './response'

type SessionUser = { id: string; email: string; role?: string; family_id?: string | null }

async function currentParent(user: SessionUser) {
  if (!user.family_id || user.role !== 'parent') return null
  const current = await prisma!.user.findUnique({
    where: { id: user.id },
    select: { family_id: true, role: true },
  })
  return current?.family_id === user.family_id && current.role === 'parent' ? current : null
}

export async function GET(request: NextRequest) {
  try {
    const deviceRefusal = await refusePairedDevice(request)
    if (deviceRefusal) return withLocationNoStore(deviceRefusal)

    const user = (await getServerUser()) as SessionUser | null
    if (!user) return locationJson({ error: 'Unauthorized' }, 401)
    const gate = await featureGate(user.family_id, 'locations')
    if (gate) return withLocationNoStore(gate)
    if (!user.family_id) return locationJson({ locations: [] })
    // Saved places carry precise addresses, which are parent-only (#102,
    // AUTHORIZATION.md). The kid dashboard has no locations surface.
    if (user.role !== 'parent') {
      return locationJson({ error: 'Only parents can view locations' }, 403)
    }
    if (!(await currentParent(user))) return locationJson({ error: 'Only parents can view locations' }, 403)

    const locations = await prisma!.familyLocation.findMany({
      where: { family_id: user.family_id },
      select: LOCATION_SELECT,
      orderBy: [{ is_primary: 'desc' }, { label: 'asc' }],
    })

    return locationJson({ locations: locations.map(toLocationResponse) })
  } catch (error) {
    logRouteError('GET /api/locations', error, getRequestId(request))
    return locationJson({ error: 'Internal server error' }, 500)
  }
}

export async function POST(request: NextRequest) {
  try {
    const deviceRefusal = await refusePairedDevice(request)
    if (deviceRefusal) return withLocationNoStore(deviceRefusal)

    const user = (await getServerUser()) as SessionUser | null
    if (!user) return locationJson({ error: 'Unauthorized' }, 401)
    const gate = await featureGate(user.family_id, 'locations')
    if (gate) return withLocationNoStore(gate)
    if (!user.family_id) return locationJson({ error: 'No family' }, 400)
    if (user.role !== 'parent') {
      return locationJson({ error: 'Only parents can add locations' }, 403)
    }
    if (!(await currentParent(user))) return locationJson({ error: 'Only parents can add locations' }, 403)

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

    const created = await prisma!.familyLocation.create({
      data: {
        family_id: user.family_id,
        user_id: user.id,
        label,
        address: address?.trim() || null,
        is_primary: label.toLowerCase() === 'home',
      },
      select: LOCATION_SELECT,
    })
    return locationJson({ location: toLocationResponse(created) }, 201)
  } catch (error) {
    logRouteError('POST /api/locations', error, getRequestId(request))
    return locationJson({ error: 'Internal server error' }, 500)
  }
}
