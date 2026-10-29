import { storageBackend } from "./storage-backend";
import { updateD1PersonEvent } from "./cloudflare/event-update";
/** Canonical online event PATCH. Absolute fields, no recurrence expansion or delete. */
import type { PrismaClient } from "@prisma/client";
import type { z } from "zod";
import type { updateEventSchema } from "./validations";
import { authorizePersonEventInTx, type PersonEventActor } from "./person-event-authority";
import type { EffectResult } from "./idempotency";
import { EVENT_READ_ONLY_CODE, EVENT_READ_ONLY_MESSAGE } from "./calendar-import/source";
export async function updatePersonEvent(
  db: Pick<PrismaClient, "$transaction">,
  actor: PersonEventActor,
  input: z.infer<typeof updateEventSchema>,
): Promise<EffectResult> {
  if (storageBackend() === "d1") return updateD1PersonEvent(actor, input);
  return db.$transaction(async tx => {
    const refused = await authorizePersonEventInTx(tx, actor, "edit");
    if (refused) return refused;
    await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id"=${input.eventId} AND "family_id"=${actor.familyId} FOR UPDATE`;
    const event = await tx.event.findFirst({ where: { id: input.eventId, family_id: actor.familyId },
      select: { start_time: true, end_time: true, recurrence: true, source_subscription_id: true } });
    if (!event) return { status: 404, body: { error: "Event not found" } };
    if (event.source_subscription_id)
      return { status: 409, body: { error: EVENT_READ_ONLY_MESSAGE, code: EVENT_READ_ONLY_CODE } };
    if (input.expected_recurrence !== undefined && event.recurrence !== input.expected_recurrence)
      return { status: 409, body: { error: "The saved repeat rule changed. Reopen the event before removing it.", code: "EVENT_RECURRENCE_CHANGED" } };
    const start = input.start_time === undefined ? event.start_time : new Date(input.start_time);
    const end = input.end_time === undefined ? event.end_time : new Date(input.end_time);
    if ((input.start_time !== undefined && !Number.isFinite(start.getTime())) ||
      (input.end_time !== undefined && !Number.isFinite(end.getTime())))
      return { status: 400, body: { error: "Invalid start or end time" } };
    if ((input.start_time !== undefined || input.end_time !== undefined) && end && end < start)
      return { status: 400, body: { error: "End time must be after start time" } };
    const { eventId, expected_recurrence: _expectedRecurrence, ...updates } = input;
    void _expectedRecurrence;
    const updated = await tx.event.update({
      where: { id: eventId, family_id: actor.familyId },
      data: { ...updates, ...(input.start_time !== undefined ? { start_time: start } : {}),
        ...(input.end_time !== undefined ? { end_time: end } : {}) },
      include: { creator: { select: { id: true, name: true } } },
    });
    return { status: 200, body: { event: updated } };
  });
}
