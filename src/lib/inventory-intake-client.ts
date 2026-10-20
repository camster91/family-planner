import {
  inventoryIntakeContext,
  inventoryIntakeInput,
  inventoryIntakeReceipt,
  type InventoryIntakeInput,
} from "@/lib/inventory-intake-contract";
import { newIdempotencyKey } from "@/lib/idempotency-key";
export type IntakeContext = { userId: string; familyId: string };
export type IntakeIntent = { key: string; body: string };
export async function readInventoryIntakeContext(
  signal: AbortSignal,
): Promise<IntakeContext> {
  const response = await fetch("/api/inventory/intake", {
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error("Intake context unavailable");
  return inventoryIntakeContext.parse(await response.json());
}
export function makeInventoryIntakeIntent(
  item: InventoryIntakeInput["item"],
  context: IntakeContext,
  key = newIdempotencyKey(),
  product?: InventoryIntakeInput["product"],
  label?: InventoryIntakeInput["label"],
): IntakeIntent {
  const input = inventoryIntakeInput.parse({
    protocol: "herewoven.inventory-intake.v1",
    expected_user_id: context.userId,
    expected_family_id: context.familyId,
    issued_at: new Date().toISOString(),
    item,
    ...(product ? { product } : {}),
    ...(label ? { label } : {}),
  });
  return { key, body: JSON.stringify(input) };
}
export type IntakeOutcome =
  | { kind: "confirmed"; itemId: string }
  | { kind: "unknown" }
  | { kind: "refused"; code: string; accessChanged?: boolean }
  | { kind: "removed" };
export async function postInventoryIntake(
  intent: IntakeIntent,
): Promise<IntakeOutcome> {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch("/api/inventory/intake", {
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
      const receipt = inventoryIntakeReceipt.safeParse(body);
      return receipt.success
        ? { kind: "confirmed", itemId: receipt.data.itemId }
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
        : "INTAKE_REFUSED";
    if (response.status >= 500 || code === "IDEMPOTENCY_IN_PROGRESS")
      return { kind: "unknown" };
    return code === "INTAKE_ITEM_REMOVED"
      ? { kind: "removed" }
      : {
          kind: "refused",
          code,
          ...([401, 403].includes(response.status)
            ? { accessChanged: true }
            : {}),
        };
  } catch {
    return { kind: "unknown" };
  } finally {
    clearTimeout(deadline);
  }
}
