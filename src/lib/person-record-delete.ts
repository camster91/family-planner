/** Canonical person deletion, including existing recurrence/import policies.
 * A keyed success and its minimal receipt commit together. */
import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  AssistantProofActor,
  AssistantSourceGuard,
} from "./assistant-source-proof";
import type { DeleteKind, DeleteTargetGuard } from "./assistant-delete-target";
import type { EffectResult } from "./idempotency";
import { lockUser, lockHousehold } from "./household-lock";
import { normalizeFeatures, isFeatureEnabled } from "./features";
import {
  EVENT_READ_ONLY_CODE,
  EVENT_READ_ONLY_MESSAGE,
} from "./calendar-import/source";
import { profileChoreLegacyWriteRefusal } from "./chore-profile";
import { refuseScheduledRoutineLegacyWrite } from "./routine-schedule-legacy";

type Db = Pick<PrismaClient, "$transaction">;
const failure = (
  status: number,
  error: string,
  code?: string,
): EffectResult => ({ status, body: { error, ...(code ? { code } : {}) } });
/** Same authority before both effect and completed-receipt recovery. */
export async function authorizePersonDelete(
  tx: Prisma.TransactionClient,
  actor: AssistantProofActor,
  kind: DeleteKind,
): Promise<EffectResult | null> {
  await lockUser(tx, actor.userId);
  await lockHousehold(tx, actor.familyId);
  const member = await tx.user.findUnique({
    where: { id: actor.userId },
    select: { family_id: true, role: true, token_version: true },
  });
  if (
    !member ||
    member.family_id !== actor.familyId ||
    member.token_version !== actor.generation ||
    member.role !== actor.role
  )
    return failure(401, "Unauthorized");
  if (
    !["parent", "teen", "child"].includes(member.role) ||
    (kind !== "chore_delete" && member.role !== "parent")
  )
    return failure(403, "Only parents can perform this action");
  await tx.$queryRaw`SELECT "id" FROM "Family" WHERE "id"=${actor.familyId} FOR SHARE`;
  const family = await tx.family.findUnique({
    where: { id: actor.familyId },
    select: { features: true },
  });
  if (!family) return failure(404, "Household not found");
  const feature =
    kind === "event_delete"
      ? "calendar"
      : kind === "chore_delete"
        ? "chores"
        : "lists";
  if (!isFeatureEnabled(normalizeFeatures(family.features), feature))
    return failure(403, "This feature is turned off for your family");
  return null;
}

/** Caller holds current membership authority and the target row lock. */
export async function deletionEligibility(
  tx: Prisma.TransactionClient,
  actor: AssistantProofActor,
  kind: DeleteKind,
  targetId: string,
): Promise<EffectResult | null> {
  if (kind === "event_delete") {
    const event = await tx.event.findUnique({
      where: { id: targetId },
      select: { family_id: true, source_subscription_id: true },
    });
    if (!event) return failure(404, "Event not found");
    if (event.family_id !== actor.familyId) return failure(403, "Forbidden");
    if (event.source_subscription_id)
      return failure(409, EVENT_READ_ONLY_MESSAGE, EVENT_READ_ONLY_CODE);
  } else if (kind === "list_delete") {
    const list = await tx.list.findUnique({
      where: { id: targetId },
      select: { family_id: true },
    });
    if (!list) return failure(404, "List not found");
    if (list.family_id !== actor.familyId) return failure(403, "Forbidden");
  } else {
    const chore = await tx.chore.findUnique({
      where: { id: targetId },
      select: {
        family_id: true,
        assigned_to: true,
        assigned_member_id: true,
        recurrence_id: true,
        is_template: true,
        frequency: true,
      },
    });
    if (!chore) return failure(404, "Chore not found");
    if (chore.family_id !== actor.familyId) return failure(403, "Forbidden");
    if (chore.assigned_to === null && chore.assigned_member_id != null)
      return { status: 409, body: profileChoreLegacyWriteRefusal() };
    if (actor.role !== "parent" && chore.assigned_to !== actor.userId)
      return failure(403, "Only parents or the assignee can delete chores");
    await refuseScheduledRoutineLegacyWrite(tx, actor.familyId, targetId);
    if (chore.recurrence_id === targetId) {
      if (
        chore.is_template &&
        ["daily", "weekly", "monthly"].includes(chore.frequency)
      )
        return failure(
          409,
          "Stop repeating before deleting the series anchor",
          "RECURRING_SERIES_REQUIRES_STOP",
        );
      if (
        await tx.chore.findFirst({
          where: {
            family_id: actor.familyId,
            recurrence_id: targetId,
            id: { not: targetId },
          },
          select: { id: true },
        })
      )
        return failure(
          409,
          "Keep the series anchor to preserve its history",
          "RECURRING_ANCHOR_RETAINS_HISTORY",
        );
    }
  }
  return null;
}

export function authorizePersonDeleteReplay(
  db: Db,
  actor: AssistantProofActor,
  kind: DeleteKind,
) {
  return db.$transaction((tx) => authorizePersonDelete(tx, actor, kind));
}

export async function deletePersonRecord(
  db: Db,
  actor: AssistantProofActor,
  kind: DeleteKind,
  targetId: string,
  recordId: string | null,
  sourceGuard?: AssistantSourceGuard,
  targetGuard?: DeleteTargetGuard,
): Promise<EffectResult> {
  return db.$transaction(async (tx) => {
    const denied = await authorizePersonDelete(tx, actor, kind);
    if (denied) return denied;
    await sourceGuard?.authorize(tx);
    if (recordId) {
      await tx.$queryRaw`SELECT "id" FROM "IdempotencyRecord" WHERE "id"=${recordId} FOR UPDATE`;
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
          body: { error: { code: "IDEMPOTENCY_IN_PROGRESS", retryable: true } },
        };
      if (receipt.response_status !== null)
        return { status: receipt.response_status, body: receipt.response_body };
    }
    await sourceGuard?.verify(tx);
    await targetGuard?.verify(tx);
    // Also serialize ordinary/no-proof canonical delete against row edits.
    if (kind === "event_delete")
      await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id"=${targetId} AND "family_id"=${actor.familyId} FOR UPDATE`;
    else if (kind === "chore_delete")
      await tx.$queryRaw`SELECT "id" FROM "Chore" WHERE "id"=${targetId} AND "family_id"=${actor.familyId} FOR UPDATE`;
    else
      await tx.$queryRaw`SELECT "id" FROM "List" WHERE "id"=${targetId} AND "family_id"=${actor.familyId} FOR UPDATE`;
    const refused = await deletionEligibility(tx, actor, kind, targetId);
    if (refused) return refused;
    sourceGuard?.assertCurrent?.();
    targetGuard?.assertCurrent();
    if (kind === "event_delete")
      await tx.event.delete({ where: { id: targetId } });
    else if (kind === "chore_delete")
      await tx.chore.delete({ where: { id: targetId } });
    else await tx.list.delete({ where: { id: targetId } });
    const result = { status: 200, body: { success: true } };
    if (recordId)
      await tx.idempotencyRecord.update({
        where: { id: recordId },
        data: { response_status: 200, response_body: result.body },
      });
    return result;
  });
}
