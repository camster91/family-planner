import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { writeDeviceAudit } from '@/lib/device-audit'
import { deviceClock, deviceError, deviceErrorBody, deviceInternalError, killSwitch } from '@/lib/device-http'
import { isRouteId, openDeviceWrite, runDeviceWrite } from '@/lib/device-writes'
import { completeChore, findHouseholdChore, isDueTodaySomewhere } from '@/lib/chore-complete'

export const dynamic = 'force-dynamic'

const ACTION = 'device.chore.complete'

/**
 * POST /api/device/chores/:id/complete { actingMemberId } + Idempotency-Key
 *
 * Chore complete from a paired tablet (#274, O-4, SHARED_DEVICE.md §9.2).
 * Gate: src/lib/device-writes.ts (kill switch, device cookie, household
 * opt-in, `chores` feature, key, household member). Then:
 *
 * - a chore of the device's household (foreign and missing are the same 404);
 * - due today (its date is "today" in some zone right now, since the server
 *   cannot know the tablet's zone), else 409 `CHORE_NOT_DUE_TODAY`;
 * - the person route's own `completeChore`: status `completed` (waiting for a
 *   parent's check, the verify flow is unchanged), no photo, no XP; the
 *   activity row names the member picked with "Who's this?".
 *
 * Responds `{ chore: { id, status }, alreadyCompleted }`, never points or XP.
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
      const chore = await findHouseholdChore(prisma!, id, ctx.actor.familyId)
      if (!chore) return { status: 404, body: deviceErrorBody('NOT_FOUND') }
      const now = deviceClock.now()
      if (!isDueTodaySomewhere(chore.due_date, now)) return { status: 409, body: deviceErrorBody('CHORE_NOT_DUE_TODAY') }

      const completed = await completeChore(prisma!, chore, ctx.member, { photoValue: null, now })
      if (!completed) {
        return { status: 200, body: { chore: { id, status: chore.status }, alreadyCompleted: true } }
      }
      await writeDeviceAudit(prisma!, {
        familyId: ctx.actor.familyId,
        deviceId: ctx.actor.deviceId,
        actorUserId: ctx.member.id,
        type: 'device.member_action',
        at: deviceClock.now(),
        metadata: { action: 'chore_complete', targetType: 'chore', targetId: id },
      })
      return { status: 200, body: { chore: { id, status: 'completed' }, alreadyCompleted: false } }
    })
  } catch (error) {
    return deviceInternalError('device.chore_complete', error)
  }
}
