import { z } from "zod";
import type { QueuedOperation } from "@/lib/offline-queue";
import { canonicalBodySignature } from "@/lib/request-signature";
import { queueOwnerClassicSchema as queueOwnerSchema } from "@/lib/queue-owner-classic";
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const operationId = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/);
export const queueReviewEntry = z.discriminatedUnion("action", [
  z
    .object({
      id: operationId,
      action: z.literal("list-item.set-checked"),
      itemId: id,
      checked: z.boolean(),
    })
    .strict(),
  z
    .object({
      id: operationId,
      action: z.literal("list-item.grocery-add"),
      listId: id,
    })
    .strict(),
  z
    .object({
      id: operationId,
      action: z.literal("device.list-item.set-checked"),
      itemId: id,
      checked: z.boolean(),
      actingMemberId: id,
    })
    .strict(),
  z
    .object({
      id: operationId,
      action: z.literal("device.list-item.add"),
      listId: id,
      actingMemberId: id,
    })
    .strict(),
]);
export const queueReviewRequest = z
  .object({ entries: z.array(queueReviewEntry).min(1).max(50) })
  .strict()
  .refine(
    (body) =>
      new Set(body.entries.map((row) => row.id)).size === body.entries.length,
  );
export type QueueReviewEntry = z.infer<typeof queueReviewEntry>;
export const queueReviewTarget = z
  .object({
    listId: id,
    listName: z.string(),
    itemId: id.nullable(),
    itemName: z.string().nullable(),
    checked: z.boolean().nullable(),
    actorName: z.string().nullable(),
    actorId: id.nullable(),
  })
  .strict();
export const queueReviewResponse = z
  .object({
    contract: z.literal("herewoven.queue-review.v1"),
    owner: queueOwnerSchema,
    rows: z
      .array(
        z
          .object({
            id: operationId,
            fingerprint: z.string(),
            target: queueReviewTarget.nullable(),
          })
          .strict(),
      )
      .max(50),
  })
  .strict();
export type QueueReviewTarget = z.infer<typeof queueReviewTarget>;
export function reviewEntry(op: QueuedOperation): QueueReviewEntry {
  const target =
    "itemId" in op.payload
      ? { itemId: op.payload.itemId, checked: op.payload.checked }
      : { listId: op.payload.listId };
  return queueReviewEntry.parse({
    id: op.id,
    action: op.action,
    ...target,
    ...(op.action.startsWith("device.") && "actingMemberId" in op.payload
      ? { actingMemberId: op.payload.actingMemberId }
      : {}),
  });
}
export const reviewFingerprint = (entry: QueueReviewEntry) =>
  canonicalBodySignature(entry);

export function matchingReviewTarget(
  entry: QueueReviewEntry,
  target: QueueReviewTarget | null,
) {
  if (target === null) return true;
  if (
    "actingMemberId" in entry
      ? target.actorId !== entry.actingMemberId || target.actorName === null
      : target.actorId !== null || target.actorName !== null
  )
    return false;
  return "itemId" in entry
    ? target.itemId === entry.itemId &&
        target.itemName !== null &&
        target.checked !== null
    : target.listId === entry.listId &&
        target.itemId === null &&
        target.itemName === null &&
        target.checked === null;
}
