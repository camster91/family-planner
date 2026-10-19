import { z } from "zod";

export const QUEUE_OWNER_CONTRACT = "herewoven.queue-owner.v1";
export const QUEUE_OWNER_HEADER = "X-Queue-Owner";
export const QUEUE_RETIREMENT_HEADER = "X-Queue-Retirement";
export const QUEUE_REVIEW_REQUIRED = "QUEUE_REVIEW_REQUIRED";
export const ORIGINAL_DEVICE_REQUIRED = "ORIGINAL_DEVICE_REQUIRED";
export const queueOwnerSchema = z
  .object({
    kind: z.enum(["person", "device"]),
    ownerId: z.string().min(1).max(128),
    scope: z.string().regex(/^[a-f0-9]{64}$/),
    generation: z.number().int().nonnegative(),
    householdScope: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type QueueOwner = z.infer<typeof queueOwnerSchema>;
export const queueOwnerResponse = z.discriminatedUnion("enabled", [
  z
    .object({
      contract: z.literal(QUEUE_OWNER_CONTRACT),
      enabled: z.literal(false),
      owner: queueOwnerSchema.optional(),
    })
    .strict(),
  z
    .object({
      contract: z.literal(QUEUE_OWNER_CONTRACT),
      enabled: z.literal(true),
      owner: queueOwnerSchema,
    })
    .strict(),
]);
export type QueueOwnerResponse = z.infer<typeof queueOwnerResponse>;
export const queueRetirementSchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("household"),
      householdScope: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
  z.object({ mode: z.literal("scope"), owner: queueOwnerSchema }).strict(),
  z
    .object({
      mode: z.literal("generation"),
      ownerId: z.string().min(1).max(128),
      throughGeneration: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({ mode: z.literal("device"), ownerId: z.string().min(1).max(128) })
    .strict(),
]);
export type QueueRetirement = z.infer<typeof queueRetirementSchema>;
export const ownedQueueEnvelope = z.discriminatedUnion("state", [
  z
    .object({
      v: z.literal(2),
      envelope: z.literal("herewoven.queue-store.v2"),
      state: z.literal("active"),
      owner: queueOwnerSchema,
      runtime: z.string().min(16).max(128),
      queue: z.string().min(1),
      reviewIds: z
        .array(z.string().regex(/^[A-Za-z0-9_-]{16,128}$/))
        .max(50)
        .optional(),
    })
    .strict(),
  z
    .object({
      v: z.literal(2),
      envelope: z.literal("herewoven.queue-store.v2"),
      state: z.literal("retired"),
    })
    .strict(),
]);
export const RETIRED_QUEUE_ENVELOPE = JSON.stringify({
  v: 2,
  envelope: "herewoven.queue-store.v2",
  state: "retired",
});

export function sameQueueOwner(a: QueueOwner, b: QueueOwner) {
  return (
    a.kind === b.kind &&
    a.ownerId === b.ownerId &&
    a.scope === b.scope &&
    a.generation === b.generation &&
    a.householdScope === b.householdScope
  );
}
