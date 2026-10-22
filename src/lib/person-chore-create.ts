/** Canonical account-assigned chore create. Effect and compact keyed receipt
 * commit together; replay never creates a second series or sends another notice.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import type { z } from "zod";
import type { createChoreSchema } from "@/lib/validations";
import type { EffectResult } from "@/lib/idempotency";
import { lockHousehold, lockUser } from "@/lib/household-lock";
import { choreAssigneeForCreateInTx } from "@/lib/chore-member-subject";
import { rotationMembersInHousehold } from "@/lib/chore-rotation";
import { expandSeriesInTx } from "@/lib/recurringChores";
import { recordChoreAssigned } from "@/lib/beta-metrics";
import { notificationServiceServer } from "@/lib/notifications-server";
import { logRouteError } from "@/lib/api-error";
export const ACCOUNT_CHORE_CREATE_ACTION = "chore.create";
export const CHORE_CREATE_INCLUDE = {
  assignee: { select: { id: true, name: true, avatar_url: true, role: true } },
  creator: { select: { id: true, name: true, avatar_url: true, role: true } },
} as const;
type Created = Prisma.ChoreGetPayload<{ include: typeof CHORE_CREATE_INCLUDE }>;
type Actor = { userId: string; familyId: string; tokenVersion: number };
type Db = Pick<PrismaClient, "$transaction" | "$executeRaw">;
type Input = z.infer<typeof createChoreSchema>;
const refusal = (status: number, code: string): EffectResult => ({
  status,
  body: { error: { code } },
});

export async function personChoreCreateAuthority(
  tx: Prisma.TransactionClient,
  actor: Actor,
) {
  const current = await tx.user.findUnique({
    where: { id: actor.userId },
    select: { family_id: true, role: true, token_version: true },
  });
  if (!current || current.token_version !== actor.tokenVersion)
    return refusal(401, "UNAUTHORIZED");
  if (current.family_id !== actor.familyId || current.role !== "parent")
    return refusal(403, "FORBIDDEN");
  return null;
}
export function authorizePersonChoreCreation(
  db: Pick<PrismaClient, "$transaction">,
  actor: Actor,
) {
  return db.$transaction(async (tx) => {
    await lockUser(tx, actor.userId);
    await lockHousehold(tx, actor.familyId);
    return personChoreCreateAuthority(tx, actor);
  });
}
export async function createPersonChore(
  db: Db,
  actor: Actor,
  input: Input,
  dueDate: Date,
  photoUrl: string | null,
  recordId: string | null,
  requestId?: string,
): Promise<EffectResult> {
  const createdRows: Created[] = [];
  const result = await db.$transaction(async (tx) => {
    const rotation = input.rotation ?? null,
      assignee = rotation ? rotation[0] : input.assigned_to!;
    for (const id of [
      ...new Set([actor.userId, assignee, ...(rotation ?? [])]),
    ].sort())
      await lockUser(tx, id);
    await lockHousehold(tx, actor.familyId);
    const denied = await personChoreCreateAuthority(tx, actor);
    if (denied) return denied;
    if (recordId) {
      await tx.$queryRaw`SELECT "id" FROM "IdempotencyRecord" WHERE "id" = ${recordId} FOR UPDATE`;
      const receipt = await tx.idempotencyRecord.findFirst({
        where: {
          id: recordId,
          scope: `user:${actor.userId}`,
          user_id: actor.userId,
          family_id: actor.familyId,
          action: ACCOUNT_CHORE_CREATE_ACTION,
        },
        select: { response_status: true, response_body: true },
      });
      if (!receipt) return refusal(409, "IDEMPOTENCY_IN_PROGRESS");
      if (receipt.response_status !== null)
        return { status: receipt.response_status, body: receipt.response_body };
    }
    const member = await tx.user.findUnique({
      where: { id: assignee },
      select: { family_id: true },
    });
    if (
      member?.family_id !== actor.familyId ||
      (rotation &&
        !(await rotationMembersInHousehold(tx, actor.familyId, rotation)))
    )
      return refusal(400, "CHORE_ASSIGNEE_UNAVAILABLE");
    const created = await tx.chore.create({
      data: {
        family_id: actor.familyId,
        title: input.title,
        description: input.description || null,
        points: input.points,
        ...(await choreAssigneeForCreateInTx(tx, actor.familyId, assignee)),
        due_date: dueDate,
        difficulty: input.difficulty,
        frequency: input.frequency,
        weekly_days: input.weekly_days ?? [],
        status: "pending",
        created_by: actor.userId,
        photo_url: photoUrl,
        icon: input.icon ?? null,
        routine: input.routine ?? null,
        routine_order: input.routine_order ?? null,
      },
      include: CHORE_CREATE_INCLUDE,
    });
    const chore =
      input.frequency === "once"
        ? created
        : await tx.chore.update({
            where: { id: created.id },
            data: {
              recurrence_id: created.id,
              is_template: true,
              ...(rotation
                ? { rotation_member_ids: rotation, rotation_index: 0 }
                : {}),
            },
            include: CHORE_CREATE_INCLUDE,
          });
    if (input.frequency !== "once")
      await expandSeriesInTx(tx, created.id, actor.familyId);
    const body = { choreId: chore.id };
    if (recordId)
      await tx.idempotencyRecord.update({
        where: { id: recordId },
        data: { response_status: 200, response_body: body },
      });
    createdRows.push(chore);
    return { status: 200, body };
  });
  const created = createdRows[0];
  if (created) {
    await recordChoreAssigned(db, actor.familyId, created);
    if (created.assignee && created.creator) {
      try {
        await notificationServiceServer.notifyChoreAssignment(
          created,
          created.assignee,
          created.creator,
        );
      } catch (error) {
        logRouteError("POST chore create assignment notice", error, requestId);
      }
    }
  }
  return result;
}

/** Ordinary API callers keep a fresh canonical response, never a cached snapshot.
 * Bound review requests need only the pointer; their separate receipt read owns
 * current-present/removed proof and never returns private chore contents.
 */
export function readCreatedPersonChore(
  db: Pick<PrismaClient, "$transaction">,
  actor: Actor,
  choreId: string,
) {
  return db.$transaction(async (tx) => {
    await lockUser(tx, actor.userId);
    await lockHousehold(tx, actor.familyId);
    const denied = await personChoreCreateAuthority(tx, actor);
    if (denied) return { ok: false as const, result: denied };
    const chore = await tx.chore.findFirst({
      where: {
        id: choreId,
        family_id: actor.familyId,
        member_subject_erased: false,
      },
      include: CHORE_CREATE_INCLUDE,
    });
    if (!chore)
      return {
        ok: false as const,
        result: refusal(409, "CHORE_CREATE_REMOVED"),
      };
    return { ok: true as const, chore };
  });
}
