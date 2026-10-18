import { z } from "zod";

export const QUEUE_OWNER_CONTRACT = "herewoven.queue-owner.v1";
export const QUEUE_OWNER_HEADER = "X-Queue-Owner";
export const QUEUE_REVIEW_REQUIRED = "QUEUE_REVIEW_REQUIRED";
export const queueOwnerSchema = z
  .object({
    kind: z.enum(["person", "device"]),
    ownerId: z.string().min(1).max(128),
    scope: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type QueueOwner = z.infer<typeof queueOwnerSchema>;
export const queueOwnerResponse = z.discriminatedUnion("enabled", [
  z
    .object({
      contract: z.literal(QUEUE_OWNER_CONTRACT),
      enabled: z.literal(false),
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
export const ownedQueueEnvelope = z.discriminatedUnion("state", [
  z
    .object({
      v: z.literal(2),
      envelope: z.literal("herewoven.queue-store.v2"),
      state: z.literal("active"),
      owner: queueOwnerSchema,
      runtime: z.string().min(16).max(128),
      queue: z.string().min(1),
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
  return a.kind === b.kind && a.ownerId === b.ownerId && a.scope === b.scope;
}
