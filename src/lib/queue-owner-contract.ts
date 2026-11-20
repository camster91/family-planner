import { z } from "zod/mini";
import { QUEUE_OWNER_CONTRACT } from "@/lib/queue-owner-shape";

// Constants, types and the owner comparison live in the Zod-free shape module
// so browser queue startup does not load Zod; these schemas stay canonical.
export {
  QUEUE_OWNER_CONTRACT,
  QUEUE_OWNER_HEADER,
  QUEUE_RETIREMENT_HEADER,
  QUEUE_REVIEW_REQUIRED,
  ORIGINAL_DEVICE_REQUIRED,
  RETIRED_QUEUE_ENVELOPE,
  sameQueueOwner,
} from "@/lib/queue-owner-shape";
export type {
  QueueOwner,
  QueueOwnerResponse,
  QueueRetirement,
} from "@/lib/queue-owner-shape";

const queueOwnerMiniSchema = z.strictObject({
  kind: z.enum(["person", "device"]),
  ownerId: z.string().check(z.minLength(1), z.maxLength(128)),
  scope: z.string().check(z.regex(/^[a-f0-9]{64}$/)),
  generation: z.number().check(z.int(), z.nonnegative()),
  householdScope: z.string().check(z.regex(/^[a-f0-9]{64}$/)),
});

export const queueOwnerSchema = queueOwnerMiniSchema;
export const queueOwnerResponse = z.discriminatedUnion("enabled", [
  z.strictObject({
    contract: z.literal(QUEUE_OWNER_CONTRACT),
    enabled: z.literal(false),
    owner: z.optional(queueOwnerSchema),
  }),
  z.strictObject({
    contract: z.literal(QUEUE_OWNER_CONTRACT),
    enabled: z.literal(true),
    owner: queueOwnerSchema,
  }),
]);
export const queueRetirementSchema = z.discriminatedUnion("mode", [
  z.strictObject({
    mode: z.literal("household"),
    householdScope: z.string().check(z.regex(/^[a-f0-9]{64}$/)),
  }),
  z.strictObject({ mode: z.literal("scope"), owner: queueOwnerSchema }),
  z.strictObject({
    mode: z.literal("generation"),
    ownerId: z.string().check(z.minLength(1), z.maxLength(128)),
    throughGeneration: z.number().check(z.int(), z.nonnegative()),
  }),
  z.strictObject({
    mode: z.literal("device"),
    ownerId: z.string().check(z.minLength(1), z.maxLength(128)),
  }),
]);
export const ownedQueueEnvelope = z.discriminatedUnion("state", [
  z.strictObject({
    v: z.literal(2),
    envelope: z.literal("herewoven.queue-store.v2"),
    state: z.literal("active"),
    owner: queueOwnerSchema,
    runtime: z.string().check(z.minLength(16), z.maxLength(128)),
    queue: z.string().check(z.minLength(1)),
    reviewIds: z.optional(
      z
        .array(z.string().check(z.regex(/^[A-Za-z0-9_-]{16,128}$/)))
        .check(z.maxLength(50)),
    ),
  }),
  z.strictObject({
    v: z.literal(2),
    envelope: z.literal("herewoven.queue-store.v2"),
    state: z.literal("retired"),
  }),
]);
