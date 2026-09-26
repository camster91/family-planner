import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashPassword, verifyPassword } from '@/lib/auth'
import { checkRateLimit } from '@/lib/rate-limit-db'
import { writeDeviceAudit } from '@/lib/device-audit'
import { isAcceptablePin } from '@/lib/elevation-pin'
import {
  deviceEmpty,
  deviceError,
  deviceInternalError,
  killSwitch,
  rateLimited,
  readJson,
} from '@/lib/device-http'
import { requireDeviceManager } from '@/lib/device-route'

/**
 * PUT /api/users/elevation-pin { pin, currentPassword } — a parent sets or
 * changes their own tablet PIN (SHARED_DEVICE.md §6.1, O-1). The PIN only
 * works through a paired device of this household; it cannot sign in anywhere.
 */
export async function PUT(request: NextRequest) {
  const off = killSwitch()
  if (off) return off
  try {
    const manager = await requireDeviceManager(request)
    if (!manager.ok) return manager.response
    const { userId, familyId } = manager

    const limit = await checkRateLimit(`device-pin-set:${userId}`, 5, 60 * 60 * 1000)
    if (!limit.allowed) return rateLimited(limit)

    const body = (await readJson(request)) as { pin?: unknown; currentPassword?: unknown } | undefined
    if (!isAcceptablePin(body?.pin)) return deviceError(400, 'PIN_TOO_WEAK')
    const pin = body!.pin as string
    if (typeof body?.currentPassword !== 'string' || !body.currentPassword) {
      return deviceError(401, 'INVALID_PASSWORD')
    }

    const user = await prisma!.user.findUnique({ where: { id: userId }, select: { password: true } })
    if (!user?.password || !(await verifyPassword(body.currentPassword, user.password))) {
      return deviceError(401, 'INVALID_PASSWORD')
    }

    const pinHash = await hashPassword(pin)
    await prisma!.parentElevationPin.upsert({
      where: { user_id: userId },
      create: { user_id: userId, family_id: familyId, pin_hash: pinHash, locked_until: null },
      update: { family_id: familyId, pin_hash: pinHash, locked_until: null },
    })
    await writeDeviceAudit(prisma!, { familyId, actorUserId: userId, type: 'parent_pin.set', metadata: {} })
    return deviceEmpty(204)
  } catch (error) {
    return deviceInternalError('elevation_pin.set', error)
  }
}

/** DELETE /api/users/elevation-pin — remove the caller's tablet PIN. Idempotent 204. */
export async function DELETE(request: NextRequest) {
  const off = killSwitch()
  if (off) return off
  try {
    const manager = await requireDeviceManager(request)
    if (!manager.ok) return manager.response
    const { count } = await prisma!.parentElevationPin.deleteMany({ where: { user_id: manager.userId } })
    if (count > 0) {
      await writeDeviceAudit(prisma!, {
        familyId: manager.familyId,
        actorUserId: manager.userId,
        type: 'parent_pin.removed',
        metadata: {},
      })
    }
    return deviceEmpty(204)
  } catch (error) {
    return deviceInternalError('elevation_pin.remove', error)
  }
}
