/** Internal effect only: freshly authorized/locked preparation context + pure
 * command plan required. Caller writes the minimal receipt in this transaction.
 * Never invoke this helper as an API or replay it outside owned idempotency. */
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  planEventPreparation,
  EventPreparationError,
  type PreparationCommand,
} from "./contract";
import type { PreparationActor, prepareEventPreparationInTx } from "./runtime";
export async function applyPreparationInTx(
  tx: Prisma.TransactionClient,
  actor: PreparationActor,
  prepared: Awaited<ReturnType<typeof prepareEventPreparationInTx>>,
  command: PreparationCommand,
  now: Date,
) {
  const effects = planEventPreparation(command, prepared.context, now);
  for (const change of effects.retime) {
    const result = await tx.chore.updateMany({
      where: {
        id: change.choreId,
        family_id: actor.familyId,
        due_date: new Date(`${change.from}T00:00:00.000Z`),
        status: { in: ["pending", "overdue"] },
        frequency: "once",
        recurrence_id: null,
        is_template: false,
        routine_stack_id: null,
        routine_series_config: { equals: Prisma.DbNull },
        successor_id: null,
        photo_url: null,
        photo_verified: false,
        verified_at: null,
        verified_notes: null,
        completed_at: null,
      },
      data: { due_date: new Date(`${change.to}T00:00:00.000Z`) },
    });
    if (result.count !== 1) throw new EventPreparationError("STALE");
  }
  const created: { clientId: string; choreId: string }[] = [];
  for (const step of effects.create) {
    // The loader locked/renewed subjects and both feature gates; the planner
    // validated canonical one-off content. No routine/recurrence/status history
    // is copied and no existing chore is reassigned or completed.
    const row = await tx.chore.create({
      data: {
        id: randomUUID(),
        family_id: actor.familyId,
        created_by: actor.userId,
        title: step.title,
        description: step.description,
        points: step.points,
        assigned_to:
          step.subject.kind === "account" ? step.subject.accountId : null,
        assigned_member_id:
          step.subject.kind === "profile" ? step.subject.memberId : null,
        member_subject_erased: false,
        due_date: new Date(`${step.dueDay}T00:00:00.000Z`),
        status: "pending",
        frequency: "once",
        is_template: false,
        recurrence_id: null,
        difficulty: step.difficulty,
        icon: step.icon,
        routine_duration_minutes: step.durationMinutes,
        routine: null,
        routine_order: null,
        routine_stack_id: null,
        routine_anchor: null,
        photo_url: null,
        photo_verified: false,
        verified_at: null,
        verified_notes: null,
        completed_at: null,
      },
      select: { id: true },
    });
    created.push({ clientId: step.clientId, choreId: row.id });
  }
  let planId = prepared.state?.id ?? null;
  if (!effects.ordered.length) {
    if (planId)
      await tx.$executeRaw`DELETE FROM "EventPreparation" WHERE "id"=${planId} AND "family_id"=${actor.familyId} AND "event_id"=${command.eventId}`;
    return { planId: null, created };
  }
  if (!planId) {
    planId = randomUUID();
    await tx.$executeRaw`INSERT INTO "EventPreparation" ("id","family_id","event_id","reviewed_event_source") VALUES (${planId},${actor.familyId},${command.eventId},${effects.reviewedEventSourceToken})`;
  } else {
    await tx.$executeRaw`UPDATE "EventPreparation" SET "reviewed_event_source"=${effects.reviewedEventSourceToken} WHERE "id"=${planId} AND "family_id"=${actor.familyId} AND "event_id"=${command.eventId}`;
  }
  for (const choreId of effects.detach)
    await tx.$executeRaw`DELETE FROM "EventPreparationStep" WHERE "family_id"=${actor.familyId} AND "preparation_id"=${planId} AND "chore_id"=${choreId}`;
  for (const [index, step] of effects.ordered.entries()) {
    const choreId =
      step.kind === "existing"
        ? step.choreId
        : created.find((row) => row.clientId === step.clientId)?.choreId;
    if (!choreId) throw new EventPreparationError("UNAVAILABLE");
    const retained = prepared.state?.links.find(
      (link) => link.choreId === choreId,
    );
    const anchor = step.cue?.anchor ?? null,
      direction = step.cue?.direction ?? null,
      minutes = step.cue?.minutes ?? null;
    if (retained) {
      await tx.$executeRaw`UPDATE "EventPreparationStep" SET "position"=${index + 1}, "cue_anchor"=${anchor}, "cue_direction"=${direction}, "cue_minutes"=${minutes} WHERE "id"=${retained.id} AND "family_id"=${actor.familyId} AND "preparation_id"=${planId} AND "chore_id"=${choreId}`;
    } else {
      await tx.$executeRaw`INSERT INTO "EventPreparationStep" ("id","family_id","preparation_id","chore_id","position","cue_anchor","cue_direction","cue_minutes") VALUES (${randomUUID()},${actor.familyId},${planId},${choreId},${index + 1},${anchor},${direction},${minutes})`;
    }
  }
  return { planId, created };
}
