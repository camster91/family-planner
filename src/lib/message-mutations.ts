import { authorizeMessageActorInTx, messageError, type MessageActor } from '@/lib/message-authority'
import { messageExpectedOwnerMatches, messageSendWindowOpen, messageSendWindowRefusal } from '@/lib/message-owner-contract'
import type { EffectResult, IdempotencyDb } from '@/lib/idempotency'
import { messageAttachmentPath } from '@/lib/message-attachments'

export const MESSAGE_SENDER_SELECT = {
  id: true,
  family_id: true,
  name: true,
  avatar_url: true,
  role: true,
} as const

export const MESSAGE_PICKUP_SELECT = {
  id: true,
  family_id: true,
  title: true,
  pickup_time: true,
  completed: true,
  assignee: { select: { id: true, name: true, family_id: true } },
} as const

export const MESSAGE_INCLUDE = {
  sender: { select: MESSAGE_SENDER_SELECT },
  pickup: { select: MESSAGE_PICKUP_SELECT },
} as const

export type MessageWriteBody = {
  issued_at?: string
  content: string
  type: 'text' | 'image' | 'voice' | 'announcement'
  pickup_id?: string | null
  attachment_ids: string[]
  expected_user_id?: string
  expected_family_id?: string
  expected_generation?: number
}

export { authorizeMessageActorInTx, messageError, type MessageActor } from '@/lib/message-authority'

function safePickup(pickup: any, familyId: string | null | undefined) {
  if (!pickup || pickup.family_id !== familyId) return null
  const assignee =
    pickup.assignee && pickup.assignee.family_id === familyId
      ? { id: pickup.assignee.id, name: pickup.assignee.name }
      : null
  return {
    id: pickup.id,
    title: pickup.title,
    pickup_time:
      pickup.pickup_time instanceof Date
        ? pickup.pickup_time.toISOString()
        : pickup.pickup_time,
    completed: pickup.completed,
    assignee,
  }
}

function safeSender(sender: any, familyId: string | null | undefined) {
  if (!sender || sender.family_id !== familyId) return null
  const { family_id: _familyId, ...publicSender } = sender
  return publicSender
}

/** Keep the legacy message fields and add only the safe pickup projection. */
export function toMessageResponse(message: any): any {
  return {
    ...message,
    // The same object is stored in IdempotencyRecord.response_body. Convert
    // Prisma Date values before that JSON write so first-send and replay use
    // the same wire representation as NextResponse.json.
    created_at:
      message.created_at instanceof Date
        ? message.created_at.toISOString()
        : message.created_at,
    sender: safeSender(message.sender, message.family_id),
    pickup: safePickup(message.pickup, message.family_id),
  }
}

async function lockReceipt(tx: any, recordId: string) {
  await tx.$queryRaw`SELECT "id" FROM "IdempotencyRecord" WHERE "id" = ${recordId} FOR UPDATE`
  return tx.idempotencyRecord.findFirst({
    where: { id: recordId },
    select: { response_status: true, response_body: true },
  })
}

/** Atomic message + pickup/attachment ownership + receipt effect. */
export async function createMessageEffect(
  db: IdempotencyDb & {
    $transaction: (
      fn: (tx: any) => Promise<EffectResult>,
    ) => Promise<EffectResult>
  },
  actor: MessageActor,
  body: MessageWriteBody,
  recordId: string | null,
): Promise<EffectResult> {
  return db.$transaction(async (tx) => {
    const writeActor = { ...actor, generation: actor.generation ?? body.expected_generation }
    const authError = await authorizeMessageActorInTx(tx, writeActor)
    if (authError) return authError
    if (!messageExpectedOwnerMatches(body, { userId: actor.id, familyId: actor.familyId, generation: writeActor.generation ?? 0 }))
      return { status: 409, body: { error: 'Message household changed. Reload before sending.', code: 'MESSAGE_OWNER_CHANGED', retryable: false } }

    if (body.issued_at !== undefined && !messageSendWindowOpen(body.issued_at)) return messageSendWindowRefusal()

    if (recordId) {
      const receipt = await lockReceipt(tx, recordId)
      if (!receipt)
        return messageError(
          409,
          'The original message request is still being processed',
        )
      if (receipt.response_status != null) {
        return { status: receipt.response_status, body: receipt.response_body }
      }
    }

    if (body.pickup_id) {
      const pickup = await tx.pickup.findFirst({
        where: { id: body.pickup_id, family_id: actor.familyId },
        select: { id: true },
      })
      if (!pickup) return messageError(404, 'Pickup not found')
    }

    const attachmentIds = [...new Set(body.attachment_ids)]
    let attachments: Array<{ id: string; filename: string }> = []
    if (attachmentIds.length > 0) {
      attachments = await tx.messageAttachment.findMany({
        where: {
          id: { in: attachmentIds },
          family_id: actor.familyId,
          uploaded_by: actor.id,
          message_id: null,
        },
        select: { id: true, filename: true },
      })
      if (attachments.length !== attachmentIds.length)
        return messageError(404, 'Message attachment not found')
    }

    // Receipt/media lookups may wait: renew time before creating any message.
    if (body.issued_at !== undefined && !messageSendWindowOpen(body.issued_at)) return messageSendWindowRefusal()
    const created = await tx.message.create({
      data: {
        family_id: actor.familyId,
        sender_id: actor.id,
        content: body.content,
        type: body.type,
        pickup_id: body.pickup_id ?? null,
        attachments: attachments.map((item) => messageAttachmentPath(item.id)),
        read_by: [actor.id],
      },
      include: MESSAGE_INCLUDE,
    })

    if (attachments.length > 0) {
      await tx.messageAttachment.updateMany({
        where: {
          id: { in: attachments.map((item) => item.id) },
          family_id: actor.familyId,
          uploaded_by: actor.id,
          message_id: null,
        },
        data: { message_id: created.id },
      })
    }

    // Preserve the legacy 200 response status; the idempotency header and
    // additive fields provide retry/context semantics without breaking older
    // chat clients.
    const result: EffectResult = {
      status: 200,
      body: { message: toMessageResponse(created) },
    }
    if (recordId) {
      await tx.idempotencyRecord.update({
        where: { id: recordId },
        data: { response_status: result.status, response_body: result.body },
      })
    }
    return result
  })
}
