import type { AssistantSourceGuard } from "./assistant-source-proof";
import { authorizePersonEventInTx, type PersonEventActor } from "./person-event-authority";
/** Event creation and its replay receipt commit together (#472). */
import type { Prisma, PrismaClient } from "@prisma/client";
import type { z } from "zod";
import type { createEventSchema } from "@/lib/validations";
import type { EffectResult } from "@/lib/idempotency";
import { recordBetaMetric } from "@/lib/beta-metrics";
import { EVENT_PEOPLE_INVALID, EVENT_PEOPLE_UNSUPPORTED, eventPeopleReady, orderEventPeople, unknownEventPeople, type EventPerson } from "@/lib/event-participants";
import { readHouseholdPeople, replaceEventParticipantsInTx } from "@/lib/event-participants-db";
import { EVENT_REPEAT_INVALID, EVENT_REPEAT_UNSUPPORTED, eventRepeatReady, seriesEventId, seriesRuleFor, seriesTopUpTarget } from "@/lib/event-series";
import { planSeriesRows, writeSeriesOccurrencesInTx } from "@/lib/event-series-db";

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
    const refs = input.participants ?? [];
    let participants: EventPerson[] = [];
    if (refs.length) {
      // Refused before any event or receipt effect, like the D1 writer.
      if (!eventPeopleReady()) return EVENT_PEOPLE_UNSUPPORTED;
      const people = await readHouseholdPeople(tx, actor.familyId);
      if (unknownEventPeople(refs, people).length) return EVENT_PEOPLE_INVALID;
      participants = orderEventPeople(refs, people);
    }
    // A repeating event: one series plus its first batch of occurrence
    // rows in this transaction. The response is the first occurrence.
    const startMs = new Date(input.start_time).getTime(), endMs = new Date(input.end_time || input.start_time).getTime();
    let series: { id: string; starts: number[] } | null = null;
    if (input.repeat) {
      if (!eventRepeatReady()) return EVENT_REPEAT_UNSUPPORTED;
      const rule = seriesRuleFor(input.repeat, startMs);
      if (!rule || endMs < startMs || input.recurrence) return EVENT_REPEAT_INVALID;
      const plan = planSeriesRows(rule, -1, Math.max(seriesTopUpTarget(Date.now()), startMs));
      const row = await tx.eventSeries.create({ data: {
        family_id: actor.familyId, created_by: actor.userId, every: rule.every, time_zone: rule.timeZone, anchor_start: new Date(startMs),
        duration_ms: endMs - startMs, until_day: rule.untilDay, title: input.title, description: input.description || null,
        location: input.location || null, event_type: input.event_type, participants: JSON.stringify(refs), generated_through: plan.generatedThrough,
      } });
      series = { id: row.id, starts: plan.starts };
    }
    const event = await tx.event.create({
      data: {
        ...(series ? { id: seriesEventId(series.id, startMs), series_id: series.id, series_occurrence_start: new Date(startMs) } : {}),
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
    if (refs.length) await replaceEventParticipantsInTx(tx, event.id, actor.familyId, refs);
    if (series) await writeSeriesOccurrencesInTx(tx, { id: series.id, family_id: actor.familyId, created_by: actor.userId, duration_ms: endMs - startMs,
      title: event.title, description: event.description, location: event.location, event_type: event.event_type }, series.starts.filter((start) => start !== startMs), refs);
    const body = JSON.parse(
      JSON.stringify({ event: { ...event, participants } }),
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
