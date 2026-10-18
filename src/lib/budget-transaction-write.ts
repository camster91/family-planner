/**
 * Transactional Budget writes with optional idempotency receipts.
 *
 * The route-level guards are intentionally repeated here. A keyed mutation
 * can outlive the request that authenticated it, so the write and its receipt
 * must re-check the current member, household, role, and effective Budget
 * feature while holding the user -> household -> receipt locks.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import type { z } from "zod";
import type {
  createTransactionSchema,
  updateTransactionSchema,
} from "@/lib/validations";
import type { EffectResult } from "@/lib/idempotency";
import { isFeatureEnabled, normalizeFeatures } from "@/lib/features";
import { lockHousehold, lockUser } from "@/lib/household-lock";

type BudgetTx = Prisma.TransactionClient;
type BudgetDb = Pick<PrismaClient, "$transaction">;
type CreateInput = z.infer<typeof createTransactionSchema>;
type UpdateInput = z.infer<typeof updateTransactionSchema>;
type Actor = { familyId: string; userId: string };
export type BudgetMutation = "create" | "update" | "delete";

const ACTIONS: Record<BudgetMutation, string> = {
  create: "budget.transaction.create",
  update: "budget.transaction.update",
  delete: "budget.transaction.delete",
};

const inProgress = (): EffectResult => ({
  status: 409,
  body: {
    error: {
      code: "IDEMPOTENCY_IN_PROGRESS",
      message: "Please retry this transaction.",
      retryable: true,
    },
  },
});

type CurrentActor = { id: string; family_id: string | null; role: string };
type Prepared = { actor: CurrentActor } | { result: EffectResult };

const transactionInclude = {
  category: {
    select: { id: true, name: true, icon: true, color: true },
  },
  user: {
    select: { id: true, name: true, avatar_url: true },
  },
} as const;

function noFamily(): EffectResult {
  return { status: 400, body: { error: "No family" } };
}

function forbidden(): EffectResult {
  return { status: 403, body: { error: "Forbidden" } };
}

function parentOnly(): EffectResult {
  return {
    status: 403,
    body: { error: "Only parents can perform this action" },
  };
}

function budgetOff(): EffectResult {
  return {
    status: 403,
    body: { error: "This feature is turned off for your family" },
  };
}

/**
 * Locks and rechecks all mutable authority before touching either the row or
 * a completed receipt. Receipt locking comes after membership locks so it
 * follows the repository-wide user -> household -> receipt order.
 */
async function prepare(
  tx: BudgetTx,
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
    select: { id: true, features: true },
  });

  if (!family || !currentActor || currentActor.family_id !== actor.familyId) {
    return { result: noFamily() };
  }
  if (currentActor.role !== "parent") {
    return { result: parentOnly() };
  }
  if (!isFeatureEnabled(normalizeFeatures(family.features), "budget")) {
    return { result: budgetOff() };
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
          body: receipt.response_body,
        },
      };
    }
  }

  return { actor: currentActor };
}

async function storeReceipt(
  tx: BudgetTx,
  recordId: string | null,
  result: EffectResult,
): Promise<void> {
  if (!recordId || result.status < 200 || result.status >= 300) return;
  await tx.idempotencyRecord.update({
    where: { id: recordId },
    data: {
      response_status: result.status,
      response_body: JSON.parse(
        JSON.stringify(result.body),
      ) as Prisma.InputJsonObject,
    },
  });
}

function transactionData(
  input: CreateInput | UpdateInput,
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if ("amount" in input && input.amount !== undefined)
    data.amount = input.amount;
  if ("type" in input && input.type !== undefined) data.type = input.type;
  if ("category_id" in input && input.category_id !== undefined) {
    data.category_id = input.category_id;
  }
  if ("description" in input && input.description !== undefined) {
    data.description = input.description;
  }
  if ("notes" in input && input.notes !== undefined) data.notes = input.notes;
  if ("date" in input && input.date !== undefined)
    data.date = new Date(input.date);
  if ("is_recurring" in input && input.is_recurring !== undefined) {
    data.is_recurring = input.is_recurring;
    if (!input.is_recurring) {
      data.recurring_interval = null;
    } else if (
      "recurring_interval" in input &&
      input.recurring_interval !== undefined
    ) {
      data.recurring_interval = input.recurring_interval;
    }
  } else if (
    "recurring_interval" in input &&
    input.recurring_interval !== undefined
  ) {
    data.recurring_interval = input.recurring_interval;
  }
  return data;
}

async function categoryCheck(
  tx: BudgetTx,
  familyId: string,
  categoryId: string | null | undefined,
): Promise<EffectResult | null> {
  if (!categoryId) return null;
  const category = await tx.budgetCategory.findUnique({
    where: { id: categoryId },
    select: { family_id: true },
  });
  if (!category) return { status: 404, body: { error: "Category not found" } };
  if (category.family_id !== familyId) return forbidden();
  return null;
}

export async function createBudgetTransactionWithReceipt(
  db: BudgetDb,
  input: CreateInput,
  actor: Actor,
  recordId: string | null,
): Promise<EffectResult> {
  return db.$transaction(async (tx) => {
    const prepared = await prepare(tx, actor, recordId);
    if ("result" in prepared) return prepared.result;

    const categoryError = await categoryCheck(
      tx,
      actor.familyId,
      input.category_id,
    );
    if (categoryError) return categoryError;

    const created = await tx.transaction.create({
      data: {
        family_id: actor.familyId,
        user_id: actor.userId,
        ...transactionData(input),
        amount: input.amount,
        type: input.type,
        category_id: input.category_id || null,
        description: input.description || null,
        notes: input.notes || null,
        date: input.date ? new Date(input.date) : new Date(),
        is_recurring: input.is_recurring || false,
        recurring_interval: input.is_recurring
          ? input.recurring_interval || null
          : null,
      },
      include: transactionInclude,
    });
    const result = {
      status: 201,
      body: { transaction: created },
    } satisfies EffectResult;
    await storeReceipt(tx, recordId, result);
    return result;
  });
}

export async function updateBudgetTransactionWithReceipt(
  db: BudgetDb,
  id: string,
  input: UpdateInput,
  actor: Actor,
  recordId: string | null,
): Promise<EffectResult> {
  return db.$transaction(async (tx) => {
    const prepared = await prepare(tx, actor, recordId);
    if ("result" in prepared) return prepared.result;

    const existing = await tx.transaction.findUnique({
      where: { id },
      select: { family_id: true },
    });
    if (!existing)
      return { status: 404, body: { error: "Transaction not found" } };
    if (existing.family_id !== actor.familyId) return forbidden();

    const categoryError = await categoryCheck(
      tx,
      actor.familyId,
      input.category_id,
    );
    if (categoryError) return categoryError;

    const updated = await tx.transaction.update({
      where: { id },
      data: transactionData(input),
      include: transactionInclude,
    });
    const result = {
      status: 200,
      body: { transaction: updated },
    } satisfies EffectResult;
    await storeReceipt(tx, recordId, result);
    return result;
  });
}

export async function deleteBudgetTransactionWithReceipt(
  db: BudgetDb,
  id: string,
  actor: Actor,
  recordId: string | null,
): Promise<EffectResult> {
  return db.$transaction(async (tx) => {
    const prepared = await prepare(tx, actor, recordId);
    if ("result" in prepared) return prepared.result;

    const existing = await tx.transaction.findUnique({
      where: { id },
      select: { family_id: true },
    });
    if (!existing)
      return { status: 404, body: { error: "Transaction not found" } };
    if (existing.family_id !== actor.familyId) return forbidden();

    await tx.transaction.delete({ where: { id } });
    const result = {
      status: 200,
      body: { success: true },
    } satisfies EffectResult;
    await storeReceipt(tx, recordId, result);
    return result;
  });
}

/**
 * Completed receipts are replayed only after the current parent, household,
 * effective Budget flag, and target-family checks pass. Missing rows are
 * allowed: a completed delete or update response must remain safe after the
 * original row is gone, without resurrecting it.
 */
export async function authorizeBudgetTransactionReplay(
  db: BudgetDb,
  mutation: BudgetMutation,
  actor: Actor,
  id?: string,
  replayKey?: string,
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
      select: { id: true, features: true },
    });
    if (!family || !currentActor || currentActor.family_id !== actor.familyId) {
      return noFamily();
    }
    if (currentActor.role !== "parent") return parentOnly();
    if (!isFeatureEnabled(normalizeFeatures(family.features), "budget")) {
      return budgetOff();
    }
    if (replayKey) {
      await tx.$queryRaw`
        SELECT "id"
        FROM "IdempotencyRecord"
        WHERE "scope" = ${`user:${actor.userId}`}
          AND "key" = ${replayKey}
        FOR UPDATE
      `;
    }
    if (mutation !== "create" && !id) {
      return { status: 400, body: { error: "Transaction ID is required" } };
    }
    if (id) {
      const existing = await tx.transaction.findUnique({
        where: { id },
        select: { family_id: true },
      });
      if (existing && existing.family_id !== actor.familyId) return forbidden();
    }
    return null;
  });
}

export const budgetTransactionAction = (mutation: BudgetMutation) =>
  ACTIONS[mutation];
