import { NextRequest } from 'next/server'
import { getServerUser } from '@/lib/supabase/server'
import { refusePairedDevice } from '@/lib/device-route'
import { prisma } from '@/lib/prisma'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'
import { createLocationSchema } from '@/lib/validations'
import { authorizeLocationMutationInTx } from '@/lib/locations-write'
import { LOCATION_SELECT, locationJson, toLocationResponse, withLocationNoStore } from '../response'

type SessionUser = { id: string; email: string; role?: string; family_id?: string | null }

/** Parent-only, family-scoped full replacement for an existing private place. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const deviceRefusal = await refusePairedDevice(request)
    if (deviceRefusal) return withLocationNoStore(deviceRefusal)

    const { id } = await params
    const user = (await getServerUser()) as SessionUser | null
    if (!user) return locationJson({ error: 'Unauthorized' }, 401)
    if (!user.family_id) return locationJson({ error: 'No family' }, 400)

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
    const result = await prisma!.$transaction(async (tx) => {
      const authError = await authorizeLocationMutationInTx(tx, { familyId: user.family_id!, userId: user.id }, 'update')
      if (authError) return authError

      const existing = await tx.familyLocation.findUnique({ where: { id }, select: { family_id: true } })
      if (!existing || existing.family_id !== user.family_id) return { status: 404 as const, body: { error: 'Not found' } }

      const { label, address } = parsed.data
      const changed = await tx.familyLocation.updateMany({
        where: { id, family_id: user.family_id! },
        data: {
          label,
          address: address?.trim() || null,
          is_primary: label.toLowerCase() === 'home',
        },
      })
      if (changed.count !== 1) return { status: 404 as const, body: { error: 'Not found' } }
      const updated = await tx.familyLocation.findUnique({ where: { id }, select: LOCATION_SELECT })
      if (!updated) return { status: 404 as const, body: { error: 'Not found' } }
      return { status: 200 as const, body: { location: toLocationResponse(updated) } }
    })
    return locationJson(result.body, result.status)
  } catch (error) {
    logRouteError('PATCH /api/locations/[id]', error, getRequestId(request))
    return locationJson({ error: 'Internal server error' }, 500)
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const deviceRefusal = await refusePairedDevice(request)
    if (deviceRefusal) return withLocationNoStore(deviceRefusal)

    const { id } = await params
    const user = (await getServerUser()) as SessionUser | null
    if (!user) return locationJson({ error: 'Unauthorized' }, 401)
    if (!user.family_id) return locationJson({ error: 'No family' }, 400)

    const result = await prisma!.$transaction(async (tx) => {
      const authError = await authorizeLocationMutationInTx(tx, { familyId: user.family_id!, userId: user.id }, 'delete')
      if (authError) return authError

      const existing = await tx.familyLocation.findUnique({ where: { id }, select: { family_id: true } })
      if (!existing || existing.family_id !== user.family_id) return { status: 404 as const, body: { error: 'Not found' } }

      const deleted = await tx.familyLocation.deleteMany({ where: { id, family_id: user.family_id! } })
      if (deleted.count !== 1) return { status: 404 as const, body: { error: 'Not found' } }
      return { status: 200 as const, body: { ok: true } }
    })
    return locationJson(result.body, result.status)
  } catch (error) {
    logRouteError('DELETE /api/locations/[id]', error, getRequestId(request))
    return locationJson({ error: 'Internal server error' }, 500)
  }
}
