import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { normalizeFeatures } from '@/lib/features'
import { deviceClock, deviceInternalError, deviceJson, killSwitch } from '@/lib/device-http'
import { authenticateDevice } from '@/lib/device-route'
import { elevationState } from '@/lib/device-session'

export const dynamic = 'force-dynamic'

/**
 * GET /api/device/me (SHARED_DEVICE.md §9.1): the device's own identity, the
 * household name, four feature booleans and the parents who can elevate.
 * Names only: no email, age, avatar, role, XP or PIN material.
 */
export async function GET(request: NextRequest) {
  const off = killSwitch()
  if (off) return off
  try {
    const auth = await authenticateDevice(request)
    if (!auth.ok) return auth.response
    const { actor, device } = auth
    const now = deviceClock.now()

    const [family, parents] = await Promise.all([
      prisma!.family.findUnique({ where: { id: actor.familyId }, select: { name: true, features: true } }),
      prisma!.user.findMany({
        where: { family_id: actor.familyId, role: 'parent' },
        select: { id: true, name: true },
        orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
      }),
    ])
    const pins = parents.length
      ? await prisma!.parentElevationPin.findMany({
          where: { user_id: { in: parents.map((p) => p.id) }, family_id: actor.familyId },
          select: { user_id: true },
        })
      : []
    const withPin = new Set(pins.map((p) => p.user_id))
    const features = normalizeFeatures(family?.features)

    return deviceJson({
      device: { id: device.id, label: device.label },
      household: { name: family?.name ?? '' },
      features: {
        calendar: features.calendar,
        chores: features.chores,
        meals: features.meals,
        lists: features.lists,
      },
      parents: parents.map((p) => ({ id: p.id, name: p.name, hasPin: withPin.has(p.id) })),
      elevation: elevationState(device, now),
    })
  } catch (error) {
    return deviceInternalError('device.me', error)
  }
}
