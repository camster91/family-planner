import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logRouteWarning } from '@/lib/api-error'
import { writeDeviceAudit } from '@/lib/device-audit'
import { deviceClock, deviceError, deviceErrorBody, deviceInternalError, killSwitch } from '@/lib/device-http'
import { isRouteId, openDeviceWrite, runDeviceWrite } from '@/lib/device-writes'
import { createListItem } from '@/lib/list-item-create'
import { getRequestId } from '@/lib/request-id'
import { deviceQueueOwner, queueOwnerMatches } from '@/lib/queue-owner-server'

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
    if (!queueOwnerMatches(request, deviceQueueOwner(ctx.actor))) return deviceError(409, 'QUEUE_OWNER_CHANGED')
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

      let auditItemId: string | null = null
      const result = await prisma!.$transaction(async (tx) => {
        if (recordId) {
          // A takeover can overlap a slow original effect. Serialise on the
          // receipt before checking for its completed response or writing the
          // item, so a retry cannot create a second row.
          await tx.$queryRaw`SELECT "id" FROM "IdempotencyRecord" WHERE "id" = ${recordId} FOR UPDATE`
          const receipt = await tx.idempotencyRecord.findFirst({
            where: { id: recordId, family_id: ctx.actor.familyId, user_id: null },
            select: { response_status: true, response_body: true },
          })
          if (!receipt) {
            return { status: 409, body: { error: { code: 'IDEMPOTENCY_IN_PROGRESS', retryable: true } } }
          }
          if (receipt.response_status != null) {
            const body = receipt.response_body as { item?: { id?: unknown } } | null
            if (typeof body?.item?.id === 'string') auditItemId = body.item.id
            return { status: receipt.response_status, body: receipt.response_body }
          }
        }

        // The list deletion path locks the same row before deleting it. Read
        // and insert under that lock so a concurrent deletion is serialized as
        // either a clean 404 (delete wins) or a committed add (add wins), never
        // a foreign-key 500 from a stale list read.
        await tx.$queryRaw`SELECT "id" FROM "List" WHERE "id" = ${listId} AND "family_id" = ${ctx.actor.familyId} FOR UPDATE`

        // If an older version committed its item but lost the response store,
        // the stable source request id lets a takeover converge without adding
        // a second row. Check after the list lock so a concurrent deletion
        // cannot return a response for an item that was just cascaded away.
        if (recordId) {
          const existing = await tx.listItem.findFirst({
            where: { source_request_id: recordId, list_id: listId, list: { family_id: ctx.actor.familyId } },
            select: { id: true, content: true, quantity: true },
          })
          if (existing) {
            auditItemId = existing.id
            const body = { item: { id: existing.id, content: existing.content, quantity: existing.quantity, listId } }
            await tx.idempotencyRecord.update({
              where: { id: recordId },
              data: { response_status: 201, response_body: body },
            })
            return {
              status: 201,
              body,
            }
          }
        }

        const created = await createListItem(
          tx,
          { listId, content, quantity: 1 },
          { familyId: ctx.actor.familyId, addedBy: ctx.member.id },
          { groceryOnly: true, sourceRequestId: recordId }
        )
        if (!created.ok) return { status: 404, body: deviceErrorBody('NOT_FOUND') }

        const itemId = String(created.item.id)
        const body = { item: { id: itemId, content, quantity: 1, listId } }
        if (recordId) {
          // Commit the response receipt with the item. This closes the crash
          // window where the row exists but the outer idempotency store dies.
          await tx.idempotencyRecord.update({
            where: { id: recordId },
            data: { response_status: 201, response_body: body },
          })
        }
        auditItemId = itemId
        return { status: 201, body }
      })

      if (auditItemId) {
        // Keep audit best-effort and repair the narrow crash window where an
        // item committed before its audit row was written.
        try {
          const logged = await prisma!.deviceAuditEvent.findMany({
            where: { family_id: ctx.actor.familyId, device_id: ctx.actor.deviceId, type: 'device.member_action' },
            select: { metadata: true },
            orderBy: { created_at: 'desc' },
            take: 200,
          })
          const audited = logged.some((e) => (e.metadata as { targetId?: unknown } | null)?.targetId === auditItemId)
          if (!audited) await audit(auditItemId)
        } catch (error) {
          // Audit repair is best effort after the item and receipt commit.
          logRouteWarning('device.list_item_audit_repair', error, getRequestId(request))
        }
      }
      return result
    })
  } catch (error) {
    return deviceInternalError('device.list_item_add', error, getRequestId(request))
  }
}
