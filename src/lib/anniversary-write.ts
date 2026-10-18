/**
 * Transactional Anniversaries writes with optional idempotency receipts.
 *
 * The HTTP routes keep the existing device, session, feature and body guards.
 * These effects repeat membership and D9 ownership checks after the canonical
 * user -> household -> receipt lock order, so a role or household change cannot
 * turn a stale request into a write. The receipt and row mutation commit
 * together; an optional key therefore makes a lost response replayable without
 * requiring a second anniversary row.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import type { z } from "zod";
import type {
  createAnniversarySchema,
  updateAnniversarySchema,
} from "@/lib/validations";
import type { EffectResult } from "@/lib/idempotency";
import { canEditOwnedRecord } from "@/lib/role-capabilities";
import { lockHousehold, lockUser } from "@/lib/household-lock";

type AnniversaryTx = Prisma.TransactionClient;
type AnniversaryDb = Pick<PrismaClient, "$transaction">;
type CreateInput = z.infer<typeof createAnniversarySchema>;
type UpdateInput = z.infer<typeof updateAnniversarySchema>;
type Actor = { familyId: string; userId: string };
type Mutation = "create" | "update" | "delete";

const inProgress = (): EffectResult => ({
  status: 409,
  body: {
    error: {
      code: "IDEMPOTENCY_IN_PROGRESS",
      message: "Please retry this date.",
      retryable: true,
    },
  },
});

type CurrentActor = { id: string; family_id: string | null; role: string };

type Prepared = { actor: CurrentActor } | { result: EffectResult };

async function prepare(
  tx: AnniversaryTx,
  actor: Actor,
  recordId: string | null,
): Promise<Prepared> {
  await lockUser(tx, actor.userId);
  await lockHousehold(tx, actor.familyId);

  const currentActor = await tx.user.findUnique({
    where: { id: actor.userId },
    select: { id: true, family_id: true, role: true },
  });
  const family = await tx.family.findUnique({
    where: { id: actor.familyId },
    select: { id: true },
  });
  if (!family || !currentActor || currentActor.family_id !== actor.familyId) {
    return { result: { status: 400, body: { error: "No family" } } };
  }

  if (recordId) {
    await tx.$queryRaw`
      SELECT "id"
      FROM "IdempotencyRecord"
      WHERE "id" = ${recordId}
      FOR UPDATE
    `;
    const receipt = await tx.idempotencyRecord.findFirst({
      where: {
        id: recordId,
        family_id: actor.familyId,
        user_id: actor.userId,
      },
      select: { response_status: true, response_body: true },
    });
    if (!receipt) return { result: inProgress() };
    if (receipt.response_status != null) {
      return {
        result: {
          status: receipt.response_status,
          body: projectReceiptBody(receipt.response_body, currentActor),
        },
      };
    }
  }

  return { actor: currentActor };
}

async function storeReceipt(
  tx: AnniversaryTx,
  recordId: string | null,
  result: EffectResult,
) {
  if (!recordId || result.status < 200 || result.status >= 300) return;
  await tx.idempotencyRecord.update({
    where: { id: recordId },
    data: {
      response_status: result.status,
      response_body: result.body as Prisma.InputJsonObject,
    },
  });
}

function authorizedForUpdate(
  currentActor: CurrentActor,
  createdBy: string | null,
) {
  return canEditOwnedRecord(currentActor.role, currentActor.id, createdBy);
}

function dateWithPermissions(
  date: { created_by: string | null },
  actor: CurrentActor,
) {
  return {
    ...date,
    can_edit: authorizedForUpdate(actor, date.created_by),
    can_delete: actor.role === "parent",
  };
}

/**
 * Stored receipts contain the original date row, but permissions are a live
 * projection. Recompute them before replaying a successful POST/PATCH so a
 * role change cannot make a cached `can_delete: true` linger in the UI.
 */
function projectReceiptBody(body: unknown, actor: CurrentActor): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const date = (body as { date?: unknown }).date;
  if (!date || typeof date !== "object" || Array.isArray(date)) return body;
  const createdBy =
    typeof (date as { created_by?: unknown }).created_by === "string"
      ? (date as { created_by: string }).created_by
      : null;
  return {
    ...body,
    date: dateWithPermissions(
      { ...(date as Record<string, unknown>), created_by: createdBy },
      actor,
    ),
  };
}

function receiptCreatedBy(
  body: unknown,
): { found: true; createdBy: string | null } | { found: false } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { found: false };
  }
  const date = (body as { date?: unknown }).date;
  if (!date || typeof date !== "object" || Array.isArray(date)) {
    return { found: false };
  }
  if (!("created_by" in date)) return { found: false };
  const createdBy = (date as { created_by?: unknown }).created_by;
  return {
    found: true,
    createdBy: typeof createdBy === "string" ? createdBy : null,
  };
}

export async function createAnniversaryWithReceipt(
  db: AnniversaryDb,
  input: CreateInput,
  actor: Actor,
  recordId: string | null,
): Promise<EffectResult> {
  return db.$transaction(async (tx) => {
    const prepared = await prepare(tx, actor, recordId);
    if ("result" in prepared) return prepared.result;

    const person = input.person_id
      ? await tx.user.findFirst({
          where: { id: input.person_id, family_id: actor.familyId },
          select: { id: true },
        })
      : null;
    if (input.person_id && !person) {
      return { status: 400, body: { error: "Person not in your family" } };
    }

    const created = await tx.anniversary.create({
      data: {
        family_id: actor.familyId,
        name: input.name,
        type: input.type,
        date: new Date(input.date),
        notes: input.notes?.trim() || null,
        person_id: input.person_id || null,
        created_by: actor.userId,
      },
    });
    const body = JSON.parse(
      JSON.stringify({ date: dateWithPermissions(created, prepared.actor) }),
    ) as Prisma.InputJsonObject;
    const result = { status: 201, body } satisfies EffectResult;
    await storeReceipt(tx, recordId, result);
    return result;
  });
}

export async function projectAnniversaryReplay(
  db: AnniversaryDb,
  result: EffectResult,
  actor: Actor,
): Promise<EffectResult> {
  return db.$transaction(async (tx) => {
    const prepared = await prepare(tx, actor, null);
    if ("result" in prepared) return prepared.result;
    return {
      ...result,
      body: projectReceiptBody(result.body, prepared.actor),
    };
  });
}

export async function updateAnniversaryWithReceipt(
  db: AnniversaryDb,
  id: string,
  input: UpdateInput,
  actor: Actor,
  recordId: string | null,
): Promise<EffectResult> {
  return db.$transaction(async (tx) => {
    const prepared = await prepare(tx, actor, recordId);
    if ("result" in prepared) return prepared.result;

    const existing = await tx.anniversary.findUnique({
      where: { id },
      select: { family_id: true, created_by: true },
    });
    if (!existing) return { status: 404, body: { error: "Not found" } };
    if (existing.family_id !== actor.familyId) {
      return { status: 403, body: { error: "Forbidden" } };
    }
    if (!authorizedForUpdate(prepared.actor, existing.created_by)) {
      return {
        status: 403,
        body: { error: "You can only edit dates you added" },
      };
    }

    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.type !== undefined) data.type = input.type;
    if (input.date !== undefined) data.date = new Date(input.date);
    if (input.notes !== undefined) data.notes = input.notes?.trim() || null;
    if (input.person_id !== undefined) {
      if (input.person_id) {
        const person = await tx.user.findFirst({
          where: { id: input.person_id, family_id: actor.familyId },
          select: { id: true },
        });
        if (!person) {
          return { status: 400, body: { error: "Person not in your family" } };
        }
      }
      data.person_id = input.person_id || null;
    }

    const updated = await tx.anniversary.update({
      where: { id },
      data,
    });
    const body = JSON.parse(
      JSON.stringify({ date: dateWithPermissions(updated, prepared.actor) }),
    ) as Prisma.InputJsonObject;
    const result = { status: 200, body } satisfies EffectResult;
    await storeReceipt(tx, recordId, result);
    return result;
  });
}

export async function deleteAnniversaryWithReceipt(
  db: AnniversaryDb,
  id: string,
  actor: Actor,
  recordId: string | null,
): Promise<EffectResult> {
  return db.$transaction(async (tx) => {
    const prepared = await prepare(tx, actor, recordId);
    if ("result" in prepared) return prepared.result;
    if (prepared.actor.role !== "parent") {
      return {
        status: 403,
        body: { error: "Only parents can perform this action" },
      };
    }

    const existing = await tx.anniversary.findUnique({
      where: { id },
      select: { family_id: true },
    });
    if (!existing) return { status: 404, body: { error: "Not found" } };
    if (existing.family_id !== actor.familyId) {
      return { status: 403, body: { error: "Forbidden" } };
    }

    await tx.anniversary.delete({ where: { id } });
    const result = {
      status: 200,
      body: { success: true },
    } satisfies EffectResult;
    await storeReceipt(tx, recordId, result);
    return result;
  });
}

/**
 * Recheck a completed replay against current household/role ownership. A
 * missing row is allowed for DELETE, while UPDATE recovers the original
 * created_by from its receipt before allowing a response after deletion.
 */
export async function authorizeAnniversaryReplay(
  db: AnniversaryDb,
  mutation: Mutation,
  actor: Actor,
  id?: string,
  replayKey?: string | null,
): Promise<EffectResult | null> {
  return db.$transaction(async (tx) => {
    await lockUser(tx, actor.userId);
    await lockHousehold(tx, actor.familyId);
    const currentActor = await tx.user.findUnique({
      where: { id: actor.userId },
      select: { id: true, family_id: true, role: true },
    });
    const family = await tx.family.findUnique({
      where: { id: actor.familyId },
      select: { id: true },
    });
    if (!family || !currentActor || currentActor.family_id !== actor.familyId) {
      return { status: 400, body: { error: "No family" } };
    }
    if (mutation === "create") return null;
    if (mutation === "delete" && currentActor.role !== "parent") {
      return {
        status: 403,
        body: { error: "Only parents can perform this action" },
      };
    }
    if (!id) return { status: 400, body: { error: "id is required" } };

    const existing = await tx.anniversary.findUnique({
      where: { id },
      select: { family_id: true, created_by: true },
    });
    if (!existing) {
      // DELETE replays intentionally remain valid after the row is gone. An
      // UPDATE replay must still prove the original row was editable by the
      // current actor; recover that ownership from the completed receipt.
      if (mutation !== "update") return null;
      if (!replayKey) {
        return {
          status: 403,
          body: { error: "You can only edit dates you added" },
        };
      }
      const receipt = await tx.idempotencyRecord.findFirst({
        where: {
          scope: `user:${actor.userId}`,
          key: replayKey,
          family_id: actor.familyId,
          user_id: actor.userId,
          action: "anniversary.update",
        },
        select: { response_body: true },
      });
      const ownership = receiptCreatedBy(receipt?.response_body);
      if (
        !ownership.found ||
        !authorizedForUpdate(currentActor, ownership.createdBy)
      ) {
        return {
          status: 403,
          body: { error: "You can only edit dates you added" },
        };
      }
      return null;
    }
    if (existing.family_id !== actor.familyId) {
      return { status: 403, body: { error: "Forbidden" } };
    }
    if (
      mutation === "update" &&
      !authorizedForUpdate(currentActor, existing.created_by)
    ) {
      return {
        status: 403,
        body: { error: "You can only edit dates you added" },
      };
    }
    return null;
  });
}
