/** Canonical target/receipt review. No inventory, receipt or product writes. */
import type { PrismaClient } from "@prisma/client";
import {
  inventoryIntakeAuthority,
  INVENTORY_INTAKE_ACTION,
  type InventoryIntakeActor,
} from "@/lib/inventory-intake";
import { INVENTORY_CHANGE_ACTION } from "@/lib/inventory-change";
import {
  restockInput,
  restockReceipt,
  INVENTORY_RESTOCK_ACTION,
} from "@/lib/inventory-restock-contract";
import {
  restockAuthority,
  compareInventoryRestock,
} from "@/lib/inventory-restock";
import {
  inventoryIntakeInput,
  inventoryIntakeReceipt,
} from "@/lib/inventory-intake-contract";
import {
  inventoryChangeInput,
  inventoryChangeReceipt,
} from "@/lib/inventory-change-contract";
import {
  IDEMPOTENCY_TTL_MS,
  hashIdempotentRequest,
  type EffectResult,
} from "@/lib/idempotency";
import { isUndoable } from "@/lib/inventory-adjust";
import {
  inventoryRecoveryEntry,
  type InventoryRecoveryEntry,
} from "@/lib/inventory-recovery-contract";
import {
  INVENTORY_RECOVERY_REVIEW_CONTRACT,
  inventoryRecoveryReview,
  type InventoryRecoveryReview,
} from "@/lib/inventory-recovery-review-contract";
type Db = Pick<PrismaClient, "$transaction">;
const fail = (status: number, code: string): EffectResult => ({
  status,
  body: { error: { code } },
});
const itemSelect = {
  id: true,
  name: true,
  amount: true,
  unit: true,
  location: true,
  status: true,
  updated_at: true,
} as const;
export async function reviewInventoryRecovery(
  db: Db,
  actor: InventoryIntakeActor,
  original: InventoryRecoveryEntry,
  ownerScope: string,
  now = Date.now(),
): Promise<EffectResult> {
  const entry = inventoryRecoveryEntry.parse(original);
  const input =
    entry.kind === "intake"
      ? inventoryIntakeInput.parse(JSON.parse(entry.body))
      : entry.kind === "restock"
        ? restockInput.parse(JSON.parse(entry.body))
        : inventoryChangeInput.parse(JSON.parse(entry.body));
  if (
    input.expected_user_id !== actor.userId ||
    input.expected_family_id !== actor.familyId
  )
    return fail(403, "AUTH_CONTEXT_CHANGED");
  const action =
    entry.kind === "intake"
      ? INVENTORY_INTAKE_ACTION
      : entry.kind === "restock"
        ? INVENTORY_RESTOCK_ACTION
        : INVENTORY_CHANGE_ACTION;
  return db.$transaction(async (tx) => {
    const refusal =
      entry.kind === "restock"
        ? await restockAuthority(tx, actor)
        : await inventoryIntakeAuthority(tx, actor);
    if (refusal) return refusal;
    const restock = entry.kind === "restock" ? restockInput.parse(input) : null;
    const targetList = restock
      ? await tx.list.findFirst({
          where: {
            id: restock.list_id,
            family_id: actor.familyId,
            type: { in: ["grocery", "shopping"] },
          },
          select: { id: true, name: true },
        })
      : null;
    const reply = (
      state: InventoryRecoveryReview["state"],
      item: {
        name: string;
        amount: number | null;
        unit: string | null;
        location: string;
        status: string;
        updated_at: Date;
      } | null = null,
      receipt: InventoryRecoveryReview["receipt"] = null,
      name: string | null = item?.name ?? null,
    ): EffectResult => {
      const validated = inventoryRecoveryReview.safeParse({
        contract: INVENTORY_RECOVERY_REVIEW_CONTRACT,
        ownerScope,
        entry,
        state,
        canRetry: state === "ready",
        name,
        receipt,
        ...(targetList ? { targetList } : {}),
        current: item
          ? {
              amount: item.amount,
              unit: item.unit,
              location: item.location,
              status: item.status,
              updatedAt: item.updated_at.toISOString(),
            }
          : null,
      });
      return validated.success
        ? { status: 200, body: validated.data }
        : fail(409, "INVENTORY_RECOVERY_UNAVAILABLE");
    };
    const receipt = await tx.idempotencyRecord.findUnique({
      where: { scope_key: { scope: `user:${actor.userId}`, key: entry.key } },
      select: {
        id: true,
        family_id: true,
        user_id: true,
        action: true,
        request_hash: true,
        response_status: true,
        response_body: true,
        expires_at: true,
      },
    });
    if (
      receipt &&
      (receipt.family_id !== actor.familyId ||
        receipt.user_id !== actor.userId ||
        receipt.action !== action ||
        receipt.request_hash !== hashIdempotentRequest(action, input))
    )
      return reply("conflict");
    // A retained successful proof may confirm history after intent expiry, but
    // an expired receipt must not authorize retry: the write route may prune it.
    if (receipt?.response_status === (entry.kind === "change" ? 200 : 201)) {
      if (restock) {
        const proof = restockReceipt.safeParse(receipt.response_body);
        if (
          !proof.success ||
          proof.data.requestId !== receipt.id ||
          proof.data.listId !== restock.list_id
        )
          return reply("unavailable");
        const row = targetList
          ? await tx.listItem.findFirst({
              where: {
                id: proof.data.itemId,
                list_id: proof.data.listId,
                list: { family_id: actor.familyId },
                ...(proof.data.created
                  ? {
                      source_request_id: proof.data.requestId,
                      added_by: actor.userId,
                    }
                  : {}),
              },
              select: { id: true, content: true },
            })
          : null;
        return reply(
          row ? "committed" : "removed",
          null,
          proof.data,
          row && row.content.length <= 200 ? row.content : null,
        );
      }
      if (entry.kind === "intake") {
        const proof = inventoryIntakeReceipt.safeParse(receipt.response_body);
        if (!proof.success) return reply("unavailable");
        const item = await tx.inventoryItem.findFirst({
          where: { id: proof.data.itemId, family_id: actor.familyId },
          select: itemSelect,
        });
        return reply(item ? "committed" : "removed", item, proof.data);
      }
      const operation = inventoryChangeInput.parse(input).operation;
      const proof = inventoryChangeReceipt.safeParse(receipt.response_body);
      if (
        !proof.success ||
        proof.data.kind !== operation.kind ||
        (operation.kind === "undo"
          ? !("adjustmentId" in proof.data) ||
            proof.data.adjustmentId !== operation.adjustment_id
          : proof.data.itemId !== operation.item_id)
      )
        return reply("unavailable");
      const item = await tx.inventoryItem.findFirst({
        where: { id: proof.data.itemId, family_id: actor.familyId },
        select: itemSelect,
      });
      if (operation.kind === "remove")
        return reply("committed", null, proof.data);
      if (!item) return reply("removed", null, proof.data);
      if ("adjustmentId" in proof.data) {
        const adjustment = await tx.inventoryAdjustment.findFirst({
          where: {
            id: proof.data.adjustmentId,
            item_id: item.id,
            family_id: actor.familyId,
            item: { family_id: actor.familyId },
          },
          select: { id: true },
        });
        if (!adjustment) return reply("unavailable");
      }
      return reply("committed", item, proof.data);
    }
    const age = now - new Date(input.issued_at).getTime();
    if (
      age < -60000 ||
      age > IDEMPOTENCY_TTL_MS - 3600000 ||
      (receipt && receipt.expires_at.getTime() <= now)
    )
      return reply("expired");
    if (receipt)
      return reply(
        receipt.response_status === null ? "pending" : "unavailable",
      );
    if (restock) {
      if (!targetList) return reply("unavailable");
      const item = await tx.inventoryItem.findFirst({
        where: { id: restock.item_id, family_id: actor.familyId },
        select: { id: true, updated_at: true, ingredient_id: true },
      });
      if (!item) return reply("unavailable");
      if (item.updated_at.toISOString() !== restock.expected_version)
        return reply("conflict");
      if (
        item.ingredient_id &&
        !(await tx.ingredient.findFirst({
          where: { id: item.ingredient_id, family_id: actor.familyId },
          select: { id: true },
        }))
      )
        return reply("unavailable");
      const comparison = await compareInventoryRestock(
        tx,
        actor.familyId,
        restock.list_id,
        item.id,
        restock.content,
        item.ingredient_id,
      );
      if (
        !comparison.existingSourceItemId &&
        !restock.allow_similar &&
        (comparison.similar.length || comparison.comparisonIncomplete)
      )
        return reply("conflict");
      return reply("ready", null, null, restock.content);
    }
    if (entry.kind === "intake") {
      const intake = inventoryIntakeInput.parse(input);
      if (intake.item.ingredient_id) {
        const ingredient = await tx.ingredient.findFirst({
          where: { id: intake.item.ingredient_id, family_id: actor.familyId },
          select: { id: true },
        });
        if (!ingredient) return reply("unavailable");
      }
      return reply("ready", null, null, intake.item.name);
    }
    const operation = inventoryChangeInput.parse(input).operation;
    if (operation.kind === "undo") {
      const adjustment = await tx.inventoryAdjustment.findFirst({
        where: {
          id: operation.adjustment_id,
          family_id: actor.familyId,
          item: { family_id: actor.familyId },
        },
        select: {
          undone_at: true,
          status_after: true,
          item_version: true,
          item: { select: itemSelect },
        },
      });
      if (!adjustment) return reply("unavailable");
      return reply(
        isUndoable(adjustment, adjustment.item) ? "ready" : "conflict",
        adjustment.item,
      );
    }
    const item = await tx.inventoryItem.findFirst({
      where: { id: operation.item_id, family_id: actor.familyId },
      select: itemSelect,
    });
    if (!item) return reply("unavailable");
    if (
      item.updated_at.toISOString() !== operation.expected_version ||
      item.status !== "active"
    )
      return reply("conflict", item);
    return reply("ready", item);
  });
}
