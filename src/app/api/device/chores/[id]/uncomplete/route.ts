import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { writeDeviceAudit } from '@/lib/device-audit'
import { deviceClock, deviceError, deviceErrorBody, deviceInternalError, killSwitch } from '@/lib/device-http'
import { isRouteId, openDeviceWrite, runDeviceWrite } from '@/lib/device-writes'
import { reopenCompletedChoreInTx } from '@/lib/chore-reopen'
import { getRequestId } from '@/lib/request-id'

export const dynamic = 'force-dynamic'

const ACTION = 'device.chore.undo'
/** How long after its own completion a tablet may undo it. */
const DEVICE_UNDO_WINDOW_MS = 2 * 60 * 1000

/**
 * POST /api/device/chores/:id/uncomplete { actingMemberId } + Idempotency-Key
 *
 * The Undo in the tablet's toast (#274). Narrower than the person route
 * (POST /api/chores/uncomplete): a tablet may only undo ITS OWN completion of
 * this chore, made in the last 2 minutes. The proof is this device's own
 * `device.member_action` / `chore_complete` audit row for the chore; a chore
 * another tablet, a person or an older tap completed is 403
 * `UNDO_NOT_ALLOWED`. Same gate as every tablet write (src/lib/device-writes.ts).
 * A chore a parent already checked stays done (409 `CHORE_ALREADY_VERIFIED`).
 * The reopen is the person route's `reopenCompletedChoreInTx`. Audited as
 * `chore_undo`.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const off = killSwitch()
  if (off) return off
  try {
    const opened = await openDeviceWrite(request, 'chores')
    if (!opened.ok) return opened.response
    const { ctx } = opened
    const { id } = await params
    if (!isRouteId(id)) return deviceError(404, 'NOT_FOUND')
    if (Object.keys(ctx.body).some((k) => k !== 'actingMemberId')) return deviceError(400, 'VALIDATION_ERROR')

    return await runDeviceWrite(ctx, ACTION, { choreId: id, actingMemberId: ctx.member.id }, async () => {
      const chore = await prisma!.chore.findFirst({
        where: { id, family_id: ctx.actor.familyId },
        select: {
          id: true,
          family_id: true,
          title: true,
          assigned_to: true,
          due_date: true,
          frequency: true,
          recurrence_id: true,
          completed_at: true,
          status: true,
        },
      })
      if (!chore) return { status: 404, body: deviceErrorBody('NOT_FOUND') }

      const now = deviceClock.now()
      const since = new Date(now.getTime() - DEVICE_UNDO_WINDOW_MS)
      const recent = await prisma!.deviceAuditEvent.findMany({
        where: {
          family_id: ctx.actor.familyId,
          device_id: ctx.actor.deviceId,
          type: 'device.member_action',
          created_at: { gte: since },
        },
        select: { metadata: true, created_at: true },
        orderBy: { created_at: 'desc' },
        take: 100,
      })
      const own = recent.find((e) => {
        const m = e.metadata as { action?: unknown; targetId?: unknown } | null
        return m?.action === 'chore_complete' && m?.targetId === id
      })
      // The completion must be the one this tablet made, not a later one by someone else.
      const completedAt = chore.completed_at?.getTime() ?? null
      if (!own || (completedAt !== null && completedAt > own.created_at.getTime())) {
        return { status: 403, body: deviceErrorBody('UNDO_NOT_ALLOWED') }
      }
      if (chore.status === 'verified') return { status: 409, body: deviceErrorBody('CHORE_ALREADY_VERIFIED') }

      // Three outcomes (src/lib/chore-reopen.ts). A parent's verify can land
      // between the read above and this transaction, so `verified` is handled
      // here too; `open` (already reopened, e.g. a second Undo with a fresh
      // key) changes nothing and writes no audit row.
      const outcome = await prisma!.$transaction((tx) => reopenCompletedChoreInTx(tx, chore))
      if (outcome === 'verified') return { status: 409, body: deviceErrorBody('CHORE_ALREADY_VERIFIED') }
      if (outcome === 'open') return { status: 200, body: { chore: { id, status: 'pending' }, alreadyOpen: true } }
      await writeDeviceAudit(prisma!, {
        familyId: ctx.actor.familyId,
        deviceId: ctx.actor.deviceId,
        actorUserId: ctx.member.id,
        type: 'device.member_action',
        at: deviceClock.now(),
        metadata: { action: 'chore_undo', targetType: 'chore', targetId: id },
      })
      return { status: 200, body: { chore: { id, status: 'pending' }, alreadyOpen: false } }
    })
  } catch (error) {
    return deviceInternalError('device.chore_undo', error, getRequestId(request))
  }
}
