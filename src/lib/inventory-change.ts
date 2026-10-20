/** Canonical stock, adjustment and compact confirmation share one live-authority transaction. */
import type { PrismaClient } from "@prisma/client";
import {
  inventoryIntakeAuthority,
  type InventoryIntakeActor,
} from "@/lib/inventory-intake";
import {
  inventoryChangeReceipt,
  type InventoryChangeInput,
  type InventoryChangeReceipt,
} from "@/lib/inventory-change-contract";
import {
  adjustInventoryItemInTransaction,
  undoInventoryAdjustmentInTransaction,
  InventoryChangeConflict,
} from "@/lib/inventory-adjust";
import {
  hashIdempotentRequest,
  IDEMPOTENCY_TTL_MS,
  type EffectResult,
} from "@/lib/idempotency";
import {
  editInventoryItemInTransaction,
  removeInventoryItemInTransaction,
} from "@/lib/inventory-edit";
import { InventoryInputError } from "@/lib/inventory";
export const INVENTORY_CHANGE_ACTION = "inventory.change.v1";
type Db = Pick<PrismaClient, "$transaction">;
const failure = (status: number, code: string): EffectResult => ({
  status,
  body: { error: { code } },
});
export async function persistInventoryChange(
  db: Db,
  actor: InventoryIntakeActor,
  input: InventoryChangeInput,
  recordId: string,
): Promise<EffectResult> {
  try {
    return await db.$transaction(async (tx) => {
      const refusal = await inventoryIntakeAuthority(tx, actor);
      if (refusal) return refusal;
      if (
        input.expected_user_id !== actor.userId ||
        input.expected_family_id !== actor.familyId
      )
        return failure(403, "AUTH_CONTEXT_CHANGED");
      await tx.$queryRaw`SELECT "id" FROM "IdempotencyRecord" WHERE "id" = ${recordId} FOR UPDATE`;
      const receipt = await tx.idempotencyRecord.findFirst({
        where: {
          id: recordId,
          scope: `user:${actor.userId}`,
          user_id: actor.userId,
          family_id: actor.familyId,
          action: INVENTORY_CHANGE_ACTION,
          request_hash: hashIdempotentRequest(INVENTORY_CHANGE_ACTION, input),
        },
        select: { response_status: true, response_body: true },
      });
      if (!receipt) return failure(409, "IDEMPOTENCY_IN_PROGRESS");
      if (receipt.response_status !== null)
        return { status: receipt.response_status, body: receipt.response_body };
      const age = Date.now() - new Date(input.issued_at).getTime();
      if (age < -60000 || age > IDEMPOTENCY_TTL_MS - 3600000)
        return failure(409, "CHANGE_INTENT_EXPIRED");
      const operation = input.operation;
      let body: InventoryChangeReceipt;
      if (operation.kind === "edit" || operation.kind === "remove") {
        const target = {
          familyId: actor.familyId,
          itemId: operation.item_id,
          expectedVersion: operation.expected_version,
        };
        const result =
          operation.kind === "edit"
            ? await editInventoryItemInTransaction(tx, {
                ...target,
                changes: operation.changes,
              })
            : await removeInventoryItemInTransaction(tx, target);
        if (!result.ok)
          return failure(
            result.reason === "NOT_FOUND" ? 404 : 409,
            result.reason === "NOT_FOUND"
              ? "CHANGE_TARGET_UNAVAILABLE"
              : "CHANGE_CONFLICT",
          );
        body = { itemId: result.itemId, kind: operation.kind };
      } else {
        const result =
          operation.kind === "undo"
            ? await undoInventoryAdjustmentInTransaction(tx, {
                familyId: actor.familyId,
                actorId: actor.userId,
                adjustmentId: operation.adjustment_id,
              })
            : await adjustInventoryItemInTransaction(tx, {
                familyId: actor.familyId,
                actorId: actor.userId,
                itemId: operation.item_id,
                kind: operation.kind,
                amount: operation.kind === "consume" ? operation.amount : null,
                expectedVersion: operation.expected_version,
                requestId: recordId,
              });
        if (!result.ok)
          return failure(
            result.reason === "NOT_FOUND" ? 404 : 409,
            result.reason === "NOT_FOUND"
              ? "CHANGE_TARGET_UNAVAILABLE"
              : result.reason === "NO_AMOUNT" ||
                  result.reason === "INVALID_AMOUNT"
                ? "CHANGE_AMOUNT_INVALID"
                : "CHANGE_CONFLICT",
          );
        body = {
          itemId: result.item.id,
          adjustmentId: result.adjustment.id,
          kind: operation.kind,
        };
      }
      await tx.idempotencyRecord.update({
        where: { id: recordId },
        data: { response_status: 200, response_body: body },
      });
      return { status: 200, body };
    });
  } catch (error) {
    if (error instanceof InventoryInputError)
      return failure(400, "CHANGE_EDIT_INVALID");
    if (error instanceof InventoryChangeConflict)
      return failure(409, "CHANGE_CONFLICT");
    throw error;
  }
}
/** Confirm the original historical operation, never return cached stock amounts as current truth. */
export async function confirmInventoryChange(
  db: Db,
  actor: InventoryIntakeActor,
  result: EffectResult,
  input: InventoryChangeInput,
): Promise<EffectResult> {
  if (result.status !== 200) return result;
  const parsed = inventoryChangeReceipt.safeParse(result.body);
  if (!parsed.success) return failure(409, "CHANGE_CONFIRMATION_UNAVAILABLE");
  return db.$transaction(async (tx) => {
    const refusal = await inventoryIntakeAuthority(tx, actor);
    if (refusal) return refusal;
    const evidence = await tx.idempotencyRecord.findFirst({
      where: {
        scope: `user:${actor.userId}`,
        user_id: actor.userId,
        family_id: actor.familyId,
        action: INVENTORY_CHANGE_ACTION,
        request_hash: hashIdempotentRequest(INVENTORY_CHANGE_ACTION, input),
        response_status: 200,
      },
      select: { response_body: true },
    });
    const proof = inventoryChangeReceipt.safeParse(evidence?.response_body);
    if (
      !proof.success ||
      hashIdempotentRequest("inventory.receipt", proof.data) !==
        hashIdempotentRequest("inventory.receipt", parsed.data)
    )
      return failure(409, "CHANGE_CONFIRMATION_UNAVAILABLE");
    if (parsed.data.kind === "remove") return result;
    if (parsed.data.kind === "edit") {
      const item = await tx.inventoryItem.findFirst({
        where: { id: parsed.data.itemId, family_id: actor.familyId },
        select: { id: true },
      });
      return item ? result : failure(409, "CHANGE_ORIGINAL_REMOVED");
    }
    const adjustment = await tx.inventoryAdjustment.findFirst({
      where: {
        id: parsed.data.adjustmentId,
        item_id: parsed.data.itemId,
        family_id: actor.familyId,
        item: { family_id: actor.familyId },
      },
      select: { id: true, item: { select: { id: true } } },
    });
    return adjustment?.item ? result : failure(409, "CHANGE_ORIGINAL_REMOVED");
  });
}
