import type { AssistantSourceGuard } from "./assistant-source-proof";
import { authorizePersonEventInTx, type PersonEventActor } from "./person-event-authority";
/** Event creation and its replay receipt commit together (#472). */
import type { Prisma, PrismaClient } from "@prisma/client";
import type { z } from "zod";
import type { createEventSchema } from "@/lib/validations";
import type { EffectResult } from "@/lib/idempotency";
import { recordBetaMetric } from "@/lib/beta-metrics";

/** Renew current authority before returning any completed private receipt. */
export async function authorizePersonEventCreationReplay(
  db: Pick<PrismaClient, "$transaction">,
  actor: PersonEventActor,
  sourceGuard?: AssistantSourceGuard,
): Promise<EffectResult | null> {
  return db.$transaction(async tx => {
    const refused = await authorizePersonEventInTx(tx, actor, "create");
    if (refused) return refused;
    // Completed replay needs current ownership, not a fresh/unchanged AI source.
    await sourceGuard?.authorize(tx);
    return null;
  });
}

export async function createPersonEvent(
  db: Pick<PrismaClient, "$transaction" | "$executeRaw">,
  input: z.infer<typeof createEventSchema>,
  actor: PersonEventActor & { name: string },
  recordId: string | null,
  sourceGuard?: AssistantSourceGuard,
): Promise<EffectResult> {
  let created = false;
  const result = await db.$transaction(async (tx) => {
    const refused = await authorizePersonEventInTx(tx, actor, "create");
    if (refused) return refused;
    await sourceGuard?.authorize(tx);
    if (recordId) {
      await tx.$queryRaw`SELECT "id" FROM "IdempotencyRecord" WHERE "id" = ${recordId} FOR UPDATE`;
      const receipt = await tx.idempotencyRecord.findFirst({
        where: {
          id: recordId,
          family_id: actor.familyId,
          user_id: actor.userId,
        },
        select: { response_status: true, response_body: true },
      });
      if (!receipt)
        return {
          status: 409,
          body: {
            error: {
              code: "IDEMPOTENCY_IN_PROGRESS",
              message: "Please retry this event.",
              retryable: true,
            },
          },
        };
      if (receipt.response_status != null)
        return { status: receipt.response_status, body: receipt.response_body };
    }
    await sourceGuard?.verify(tx);
    const event = await tx.event.create({
      data: {
        family_id: actor.familyId,
        created_by: actor.userId,
        title: input.title,
        description: input.description || null,
        start_time: new Date(input.start_time),
        end_time: new Date(input.end_time || input.start_time),
        location: input.location || null,
        event_type: input.event_type,
        recurrence: input.recurrence || null,
      },
    });
    await tx.activity.create({
      data: {
        family_id: actor.familyId,
        user_id: actor.userId,
        type: "event_created",
        title: `${actor.name} added "${event.title}" to the calendar`,
        metadata: JSON.stringify({ eventId: event.id }),
      },
    });
    const body = JSON.parse(
      JSON.stringify({ event }),
    ) as Prisma.InputJsonObject;
    if (recordId)
      await tx.idempotencyRecord.update({
        where: { id: recordId },
        data: { response_status: 200, response_body: body },
      });
    created = true;
    return { status: 200, body };
  });
  if (created) await recordBetaMetric(db, actor.familyId, "event_created");
  return result;
}
