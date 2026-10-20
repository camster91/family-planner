import {
  restockInput,
  restockReceipt,
  restockReview,
  type RestockInput,
} from "@/lib/inventory-restock-contract";
import { inventoryWriteDeadline } from "@/lib/inventory-write-deadline";
import { readBoundedInventoryJson } from "@/lib/inventory-reader";
import {
  INVENTORY_READ_SCOPE_HEADER,
  inventoryReadScopeValue,
} from "@/lib/inventory-read-scope";
import { INVENTORY_RECOVERY_OWNER_HEADER } from "@/lib/inventory-recovery-contract";
import { newIdempotencyKey } from "@/lib/idempotency-key";
import type { IntakeContext } from "@/lib/inventory-intake-client";
export type RestockIntent = { key: string; body: string };
export type RestockOutcome =
  | { kind: "confirmed"; receipt: ReturnType<typeof restockReceipt.parse> }
  | { kind: "unknown" }
  | { kind: "removed" }
  | { kind: "not_applied" }
  | { kind: "refused"; code: string };
export function makeRestockIntent(
  draft: Omit<
    RestockInput,
    "protocol" | "expected_user_id" | "expected_family_id" | "issued_at"
  >,
  context: IntakeContext,
  key = newIdempotencyKey(),
): RestockIntent {
  return {
    key,
    body: JSON.stringify(
      restockInput.parse({
        protocol: "herewoven.inventory-restock.v1",
        expected_user_id: context.userId,
        expected_family_id: context.familyId,
        issued_at: new Date().toISOString(),
        ...draft,
      }),
    ),
  };
}
async function boundedRequest(
  path: string,
  init: RequestInit,
  beforeBody?: (response: Response) => void,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    return await inventoryWriteDeadline(async () => {
      const response = await fetch(path, {
        ...init,
        cache: "no-store",
        signal: controller.signal,
      });
      beforeBody?.(response);
      const body: unknown = await readBoundedInventoryJson(
        response,
        controller.signal,
        128 * 1024,
      );
      return { kind: "reply" as const, response, body };
    });
  } finally {
    clearTimeout(timer);
  }
}
export async function readRestockReview(
  context: IntakeContext,
  itemId: string,
  listId?: string,
  content?: string,
) {
  const scope = inventoryReadScopeValue(context);
  const reply = await boundedRequest(
    "/api/inventory/restock/review",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [INVENTORY_READ_SCOPE_HEADER]: scope,
      },
      body: JSON.stringify({
        itemId,
        ...(listId ? { listId } : {}),
        ...(content?.trim() ? { content: content.trim() } : {}),
      }),
    },
    (response) => {
      if (
        !response.ok ||
        response.headers.get(INVENTORY_READ_SCOPE_HEADER) !== scope
      )
        throw new Error("Restock review unavailable");
    },
  );
  if (reply.kind !== "reply") throw new Error("Restock review unavailable");
  const data = restockReview.parse(reply.body);
  if (
    data.userId !== context.userId ||
    data.familyId !== context.familyId ||
    data.item.id !== itemId ||
    data.selectedListId !== (listId ?? null)
  )
    throw new Error("Restock review changed");
  return data;
}
export async function postInventoryRestock(
  intent: RestockIntent,
  ownerScope?: string,
): Promise<RestockOutcome> {
  try {
    const reply = await boundedRequest("/api/inventory/restock", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": intent.key,
        ...(ownerScope
          ? { [INVENTORY_RECOVERY_OWNER_HEADER]: ownerScope }
          : {}),
      },
      body: intent.body,
    });
    if (reply.kind !== "reply") return { kind: "unknown" };
    if (reply.response.ok) {
      const proof = restockReceipt.safeParse(reply.body),
        input = restockInput.parse(JSON.parse(intent.body));
      return proof.success && proof.data.listId === input.list_id
        ? { kind: "confirmed", receipt: proof.data }
        : { kind: "unknown" };
    }
    const body = reply.body as { error?: { code?: unknown } };
    const code =
      typeof body?.error?.code === "string"
        ? body.error.code
        : "RESTOCK_REFUSED";
    if (
      reply.response.status >= 500 ||
      ["IDEMPOTENCY_IN_PROGRESS", "RESTOCK_CONFIRMATION_UNAVAILABLE"].includes(
        code,
      )
    )
      return { kind: "unknown" };
    if (code === "RESTOCK_ORIGINAL_REMOVED") return { kind: "removed" };
    if (
      [
        "RESTOCK_SOURCE_CHANGED",
        "RESTOCK_DUPLICATE_REVIEW_REQUIRED",
        "RESTOCK_LIST_UNAVAILABLE",
        "RESTOCK_SOURCE_UNAVAILABLE",
        "RESTOCK_TARGET_UNAVAILABLE",
        "INVALID_RESTOCK",
      ].includes(code)
    )
      return { kind: "not_applied" };
    return { kind: "refused", code };
  } catch {
    return { kind: "unknown" };
  }
}
export async function undoRestock(
  requestId: string,
  context: IntakeContext,
): Promise<
  | { kind: "confirmed"; removedCount: number; keptCheckedCount: number }
  | { kind: "unknown" }
  | { kind: "refused" }
> {
  try {
    const reply = await boundedRequest("/api/inventory/restock/undo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestId,
        expected_user_id: context.userId,
        expected_family_id: context.familyId,
      }),
    });
    if (reply.kind !== "reply") return { kind: "unknown" };
    const body = reply.body as {
      requestId?: unknown;
      removedCount?: unknown;
      keptCheckedCount?: unknown;
    };
    if (reply.response.ok)
      return body?.requestId === requestId &&
        Number.isInteger(body.removedCount) &&
        Number.isInteger(body.keptCheckedCount) &&
        Number(body.removedCount) >= 0 &&
        Number(body.keptCheckedCount) >= 0
        ? {
            kind: "confirmed",
            removedCount: Number(body.removedCount),
            keptCheckedCount: Number(body.keptCheckedCount),
          }
        : { kind: "unknown" };
    return reply.response.status >= 500
      ? { kind: "unknown" }
      : { kind: "refused" };
  } catch {
    return { kind: "unknown" };
  }
}
