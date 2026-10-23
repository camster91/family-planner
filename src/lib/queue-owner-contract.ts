import { z } from "zod/mini";

export const QUEUE_OWNER_CONTRACT = "herewoven.queue-owner.v1";
export const QUEUE_OWNER_HEADER = "X-Queue-Owner";
export const QUEUE_RETIREMENT_HEADER = "X-Queue-Retirement";
export const QUEUE_REVIEW_REQUIRED = "QUEUE_REVIEW_REQUIRED";
export const ORIGINAL_DEVICE_REQUIRED = "ORIGINAL_DEVICE_REQUIRED";
export type QueueOwner = {
  kind: "person" | "device";
  ownerId: string;
  scope: string;
  generation: number;
  householdScope: string;
};

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
export type QueueOwnerResponse =
  | {
      contract: typeof QUEUE_OWNER_CONTRACT;
      enabled: false;
      owner?: QueueOwner;
    }
  | {
      contract: typeof QUEUE_OWNER_CONTRACT;
      enabled: true;
      owner: QueueOwner;
    };
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
export type QueueRetirement =
  | { mode: "household"; householdScope: string }
  | { mode: "scope"; owner: QueueOwner }
  | { mode: "generation"; ownerId: string; throughGeneration: number }
  | { mode: "device"; ownerId: string };
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
