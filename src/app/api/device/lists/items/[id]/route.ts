import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { writeDeviceAudit } from '@/lib/device-audit'
import { deviceClock, deviceError, deviceErrorBody, deviceInternalError, killSwitch } from '@/lib/device-http'
import { isRouteId, openDeviceWrite, runDeviceWrite } from '@/lib/device-writes'
import { isGroceryListType } from '@/lib/grocery-display'
import { DUPLICATE_OPEN_ITEM, updateListItemAndNoteTick } from '@/lib/list-item-update'
import { getRequestId } from '@/lib/request-id'

export const dynamic = 'force-dynamic'

/** Idempotency action name; part of the stored request hash. */
const ACTION = 'device.list-item.set-checked'

/**
 * PATCH /api/device/lists/items/:id { checked, actingMemberId } + Idempotency-Key
 *
 * Grocery tick/untick from a paired tablet (#274, SHARED_DEVICE.md §9.2).
 * Gate: src/lib/device-writes.ts (kill switch, device cookie, household
 * opt-in, `lists` feature, key, household member). The write is the person
 * route's own `updateListItemAndNoteTick`: explicit desired state, last write
 * wins, a no-op keeps the original attribution. `checked_by` is the member
 * picked with "Who's this?". Only items of the household's grocery/shopping
 * lists (the ones the tablet shows); anything else, foreign or missing, is the
 * same 404. Responds with `{ item: { id, checked } }` only: no notes or price.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const off = killSwitch()
  if (off) return off
  try {
    const opened = await openDeviceWrite(request, 'lists')
    if (!opened.ok) return opened.response
    const { ctx } = opened
    const { id } = await params
    if (!isRouteId(id)) return deviceError(404, 'NOT_FOUND')
    const { checked } = ctx.body
    if (typeof checked !== 'boolean' || Object.keys(ctx.body).some((k) => k !== 'checked' && k !== 'actingMemberId')) {
      return deviceError(400, 'VALIDATION_ERROR', { message: 'Send `checked` (true or false) and `actingMemberId`.' })
    }

    return await runDeviceWrite(ctx, ACTION, { itemId: id, checked, actingMemberId: ctx.member.id }, async () => {
      const item = await prisma!.listItem.findFirst({
        where: { id, list: { family_id: ctx.actor.familyId } },
        select: { id: true, checked: true, list: { select: { type: true } } },
      })
      if (!item || !isGroceryListType(item.list.type)) return { status: 404, body: deviceErrorBody('NOT_FOUND') }

      const result = await updateListItemAndNoteTick(
        prisma!,
        { itemId: id, checked },
        { id: ctx.member.id, family_id: ctx.actor.familyId }
      )
      if (result.status === 409 && typeof result.body.error === 'object' && result.body.error.code === DUPLICATE_OPEN_ITEM) {
        return { status: 409, body: deviceErrorBody('DUPLICATE_OPEN_ITEM') }
      }
      if (result.status !== 200) return { status: 404, body: deviceErrorBody('NOT_FOUND') }

      // Audited when this request changed the row; a no-op changed nothing.
      if (item.checked !== checked) {
        await writeDeviceAudit(prisma!, {
          familyId: ctx.actor.familyId,
          deviceId: ctx.actor.deviceId,
          actorUserId: ctx.member.id,
          type: 'device.member_action',
          at: deviceClock.now(),
          metadata: { action: checked ? 'list_item_check' : 'list_item_uncheck', targetType: 'list_item', targetId: id },
        })
      }
      return { status: 200, body: { item: { id, checked: result.body.item.checked === true } } }
    })
  } catch (error) {
    return deviceInternalError('device.list_item_check', error, getRequestId(request))
  }
}
