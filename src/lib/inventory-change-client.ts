import {
  inventoryChangeInput,
  inventoryChangeReceipt,
  type InventoryChangeOperation,
  type InventoryChangeReceipt,
} from "@/lib/inventory-change-contract";
import type { IntakeContext } from "@/lib/inventory-intake-client";
import { newIdempotencyKey } from "@/lib/idempotency-key";
export type InventoryChangeIntent = { key: string; body: string };
export function makeInventoryChangeIntent(
  operation: InventoryChangeOperation,
  context: IntakeContext,
  key = newIdempotencyKey(),
): InventoryChangeIntent {
  return {
    key,
    body: JSON.stringify(
      inventoryChangeInput.parse({
        protocol: "herewoven.inventory-change.v1",
        expected_user_id: context.userId,
        expected_family_id: context.familyId,
        issued_at: new Date().toISOString(),
        operation,
      }),
    ),
  };
}
export type InventoryChangeOutcome =
  | { kind: "confirmed"; receipt: InventoryChangeReceipt }
  | { kind: "unknown" }
  | { kind: "refused"; code: string }
  | { kind: "removed" }
  | { kind: "not_applied" };
export async function postInventoryChange(
  intent: InventoryChangeIntent,
): Promise<InventoryChangeOutcome> {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch("/api/inventory/change", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": intent.key,
      },
      body: intent.body,
      signal: controller.signal,
    });
    const body: unknown = await response.json();
    if (response.ok) {
      const receipt = inventoryChangeReceipt.safeParse(body);
      const original = inventoryChangeInput.parse(
        JSON.parse(intent.body),
      ).operation;
      return receipt.success &&
        receipt.data.kind === original.kind &&
        (original.kind === "undo"
          ? receipt.data.adjustmentId === original.adjustment_id
          : receipt.data.itemId === original.item_id)
        ? { kind: "confirmed", receipt: receipt.data }
        : { kind: "unknown" };
    }
    const code =
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "object" &&
      body.error !== null &&
      "code" in body.error &&
      typeof body.error.code === "string"
        ? body.error.code
        : "CHANGE_REFUSED";
    if (
      response.status >= 500 ||
      code === "IDEMPOTENCY_IN_PROGRESS" ||
      code === "CHANGE_CONFIRMATION_UNAVAILABLE"
    )
      return { kind: "unknown" };
    if (
      (response.status === 409 &&
        ["CHANGE_CONFLICT", "CHANGE_AMOUNT_INVALID"].includes(code)) ||
      (response.status === 404 && code === "CHANGE_TARGET_UNAVAILABLE")
    )
      return { kind: "not_applied" };
    return code === "CHANGE_ORIGINAL_REMOVED"
      ? { kind: "removed" }
      : { kind: "refused", code };
  } catch {
    return { kind: "unknown" };
  } finally {
    clearTimeout(deadline);
  }
}
