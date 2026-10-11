/** Event creation and its replay receipt commit together (#472). */
import type { Prisma, PrismaClient } from '@prisma/client'
import type { z } from 'zod'
import type { createEventSchema } from '@/lib/validations'
import type { EffectResult } from '@/lib/idempotency'
import { recordBetaMetric } from '@/lib/beta-metrics'

export async function createPersonEvent(
  db: Pick<PrismaClient, '$transaction' | '$executeRaw'>,
  input: z.infer<typeof createEventSchema>,
  actor: { familyId: string; userId: string; name: string },
  recordId: string | null,
): Promise<EffectResult> {
  let created = false
  const result = await db.$transaction(async (tx) => {
    if (recordId) {
      await tx.$queryRaw`SELECT "id" FROM "IdempotencyRecord" WHERE "id" = ${recordId} FOR UPDATE`
      const receipt = await tx.idempotencyRecord.findFirst({
        where: { id: recordId, family_id: actor.familyId, user_id: actor.userId },
        select: { response_status: true, response_body: true },
      })
      if (!receipt) return { status: 409, body: { error: { code: 'IDEMPOTENCY_IN_PROGRESS', message: 'Please retry this event.', retryable: true } } }
      if (receipt.response_status != null) return { status: receipt.response_status, body: receipt.response_body }
    }
    const event = await tx.event.create({ data: {
      family_id: actor.familyId, created_by: actor.userId,
      title: input.title, description: input.description || null,
      start_time: new Date(input.start_time),
      end_time: new Date(input.end_time || input.start_time),
      location: input.location || null, event_type: input.event_type,
      recurrence: input.recurrence || null,
    } })
    await tx.activity.create({ data: {
      family_id: actor.familyId, user_id: actor.userId,
      type: 'event_created', title: `${actor.name} added "${event.title}" to the calendar`,
      metadata: JSON.stringify({ eventId: event.id }),
    } })
    const body = JSON.parse(JSON.stringify({ event })) as Prisma.InputJsonObject
    if (recordId) await tx.idempotencyRecord.update({ where: { id: recordId }, data: { response_status: 200, response_body: body } })
    created = true
    return { status: 200, body }
  })
  if (created) await recordBetaMetric(db, actor.familyId, 'event_created')
  return result
}
