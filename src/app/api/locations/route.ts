import { NextRequest } from 'next/server'
import { getServerUser } from '@/lib/supabase/server'
import { refusePairedDevice } from '@/lib/device-route'
import { prisma } from '@/lib/prisma'
import { featureGate } from '@/lib/feature-gate-server'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'
import { createLocationSchema } from '@/lib/validations'
import { readIdempotencyKey, withIdempotency, type EffectResult } from '@/lib/idempotency'
import { authorizeLocationMutationInTx } from '@/lib/locations-write'
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
    if (!user.family_id) return locationJson({ error: 'No family' }, 400)

    // Run live parent and feature checks before idempotency can replay a
    // stored private response. The transaction below repeats both checks
    // after taking the canonical membership locks for the first attempt.
    const gate = await featureGate(user.family_id, 'locations')
    if (gate) return withLocationNoStore(gate)
    if (!(await currentParent(user))) {
      return locationJson({ error: 'Only parents can add locations' }, 403)
    }

    const { key, error: keyError } = readIdempotencyKey(request)
    if (keyError) return withLocationNoStore(keyError)

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
    const response = await withIdempotency(
      prisma!,
      key,
      { scope: `user:${user.id}`, familyId: user.family_id, userId: user.id, action: 'location.create' },
      parsed.data,
      async ({ recordId }): Promise<EffectResult> => {
        return prisma!.$transaction(async (tx) => {
          const authError = await authorizeLocationMutationInTx(tx, { familyId: user.family_id!, userId: user.id }, 'add')
          if (authError) return authError

          // The receipt is locked after the membership locks, matching the
          // account-deletion order. Stamping the canonical response in this
          // transaction makes a lost 201 replay without a second location.
          if (recordId) {
            await tx.$queryRaw`SELECT "id" FROM "IdempotencyRecord" WHERE "id" = ${recordId} FOR UPDATE`
            const receipt = await tx.idempotencyRecord.findFirst({
              where: { id: recordId, family_id: user.family_id!, user_id: user.id },
              select: { response_status: true, response_body: true },
            })
            if (!receipt) {
              return {
                status: 409,
                body: { error: { code: 'IDEMPOTENCY_IN_PROGRESS', message: 'Please retry this location.', retryable: true } },
              }
            }
            if (receipt.response_status != null) {
              return { status: receipt.response_status, body: receipt.response_body }
            }
          }

          const { label, address } = parsed.data
          const created = await tx.familyLocation.create({
            data: {
              family_id: user.family_id!,
              user_id: user.id,
              label,
              address: address?.trim() || null,
              is_primary: label.toLowerCase() === 'home',
            },
            select: LOCATION_SELECT,
          })
          const body = { location: toLocationResponse(created) }
          if (recordId) {
            await tx.idempotencyRecord.update({
              where: { id: recordId },
              data: { response_status: 201, response_body: body },
            })
          }
          return { status: 201, body }
        })
      },
    )
    return withLocationNoStore(response)
  } catch (error) {
    logRouteError('POST /api/locations', error, getRequestId(request))
    return locationJson({ error: 'Internal server error' }, 500)
  }
}
