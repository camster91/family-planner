import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkRateLimit } from '@/lib/rate-limit-db'
import type { RevokeReason } from '@/lib/device-audit'
import { DEVICE_LIST_SELECT, serializeDevice } from '@/lib/device-admin'
import {
  deviceClock,
  deviceError,
  deviceInternalError,
  deviceJson,
  killSwitch,
  rateLimited,
  readJson,
} from '@/lib/device-http'
import { requireDeviceManager } from '@/lib/device-route'
import { revokeDevice } from '@/lib/device-session'

// Request reasons map onto the fixed audit vocabulary (§10); "other" is a plain parent removal.
const REASONS: Record<string, RevokeReason> = { lost: 'lost', replaced: 'replaced', other: 'parent' }

/**
 * POST /api/family/devices/:id/revoke { reason? } — remove a tablet (parent
 * only). Idempotent: revoking an already-removed tablet returns it unchanged.
 * The tablet's next access, refresh or elevation gets 401 DEVICE_REVOKED.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const off = killSwitch()
  if (off) return off
  try {
    const manager = await requireDeviceManager(request)
    if (!manager.ok) return manager.response
    const { id } = await params
    const { familyId, userId } = manager

    const body = (await readJson(request)) as { reason?: unknown } | undefined
    let reason: RevokeReason = 'parent'
    if (body?.reason !== undefined && body?.reason !== null) {
      const mapped = typeof body.reason === 'string' ? REASONS[body.reason] : undefined
      if (!mapped) return deviceError(400, 'VALIDATION_ERROR', { message: "reason must be 'lost', 'replaced' or 'other'." })
      reason = mapped
    }

    const limit = await checkRateLimit(`device-revoke:${userId}`, 30, 60 * 60 * 1000)
    if (!limit.allowed) return rateLimited(limit)

    const existing = await prisma!.householdDevice.findFirst({ where: { id, family_id: familyId }, select: { id: true } })
    if (!existing) return deviceError(404, 'NOT_FOUND')

    await revokeDevice(prisma!, { deviceId: id, familyId, revokedBy: userId, reason, now: deviceClock.now() })

    const row = await prisma!.householdDevice.findFirst({ where: { id, family_id: familyId }, select: DEVICE_LIST_SELECT })
    return deviceJson({ device: row ? serializeDevice(row, false) : null })
  } catch (error) {
    return deviceInternalError('family_devices.revoke', error)
  }
}
