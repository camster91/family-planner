import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { writeDeviceAudit } from '@/lib/device-audit'
import { deviceClock, deviceError, deviceErrorBody, deviceInternalError, killSwitch } from '@/lib/device-http'
import { isRouteId, openDeviceWrite, runDeviceWrite } from '@/lib/device-writes'
import { createListItem } from '@/lib/list-item-create'
import { getRequestId } from '@/lib/request-id'

export const dynamic = 'force-dynamic'

const ACTION = 'device.list-item.add'
const DEVICE_ITEM_MAX_CHARS = 200

/**
 * POST /api/device/lists/:id/items { content, actingMemberId } + Idempotency-Key
 *
 * Grocery quick add from a paired tablet (#274, SHARED_DEVICE.md §9.2): an
 * existing grocery/shopping list of the household, `content` 1–200 characters,
 * quantity 1, no notes, price or ingredient. `added_by` is the member picked
 * with "Who's this?". The write is the person route's `createListItem`.
 * A foreign, missing or non-grocery list is the same 404.
 * Responds `201 { item: { id, content, quantity, listId } }`.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const off = killSwitch()
  if (off) return off
  try {
    const opened = await openDeviceWrite(request, 'lists')
    if (!opened.ok) return opened.response
    const { ctx } = opened
    const { id: listId } = await params
    if (!isRouteId(listId)) return deviceError(404, 'NOT_FOUND')
    const raw = ctx.body.content
    const content = typeof raw === 'string' ? raw.trim() : ''
    if (
      !content ||
      content.length > DEVICE_ITEM_MAX_CHARS ||
      Object.keys(ctx.body).some((k) => k !== 'content' && k !== 'actingMemberId')
    ) {
      return deviceError(400, 'VALIDATION_ERROR', { message: `Use 1 to ${DEVICE_ITEM_MAX_CHARS} characters.` })
    }

    return await runDeviceWrite(ctx, ACTION, { listId, content, actingMemberId: ctx.member.id }, async ({ recordId }) => {
      const audit = (itemId: string) =>
        writeDeviceAudit(prisma!, {
          familyId: ctx.actor.familyId,
          deviceId: ctx.actor.deviceId,
          actorUserId: ctx.member.id,
          type: 'device.member_action',
          at: deviceClock.now(),
          metadata: { action: 'list_item_add', targetType: 'list_item', targetId: itemId },
        })

      // Convergence after a lock takeover: an earlier run of this same key may
      // have committed the row and died before its response was stored. The
      // row carries the record id, so the retry answers with that row instead
      // of adding a second one (like the from-recipe add and the #277 commit).
      if (recordId) {
        const existing = await prisma!.listItem.findFirst({
          where: { source_request_id: recordId, list_id: listId, list: { family_id: ctx.actor.familyId } },
          select: { id: true, content: true, quantity: true },
        })
        if (existing) {
          // The first run may also have died before its audit row.
          const logged = await prisma!.deviceAuditEvent.findMany({
            where: { family_id: ctx.actor.familyId, device_id: ctx.actor.deviceId, type: 'device.member_action' },
            select: { metadata: true },
            orderBy: { created_at: 'desc' },
            take: 200,
          })
          const audited = logged.some((e) => (e.metadata as { targetId?: unknown } | null)?.targetId === existing.id)
          if (!audited) await audit(existing.id)
          return {
            status: 201,
            body: { item: { id: existing.id, content: existing.content, quantity: existing.quantity, listId } },
          }
        }
      }

      const result = await createListItem(
        prisma!,
        { listId, content, quantity: 1 },
        { familyId: ctx.actor.familyId, addedBy: ctx.member.id },
        { groceryOnly: true, sourceRequestId: recordId }
      )
      if (!result.ok) return { status: 404, body: deviceErrorBody('NOT_FOUND') }
      const itemId = String(result.item.id)
      await audit(itemId)
      return { status: 201, body: { item: { id: itemId, content, quantity: 1, listId } } }
    })
  } catch (error) {
    return deviceInternalError('device.list_item_add', error, getRequestId(request))
  }
}
