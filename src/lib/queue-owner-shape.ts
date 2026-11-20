/**
 * Zod-free queue ownership constants, types and browser checks.
 *
 * Browser queues start on the cold Today board, so their startup graph must
 * not import Zod (#413). These checks mirror the Zod Mini schemas in
 * queue-owner-contract.ts, which re-exports everything here and stays the
 * server/composition contract; parity is tested.
 */
import {
  SHAPE_FAILURE,
  arrayOf,
  isNonNegativeSafeInteger,
  isOneOf,
  isStringLength,
  matchesPattern,
  shapeSuccess,
  strictRecord,
  type ShapeResult,
} from "@/lib/browser-shape";

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
export type QueueRetirement =
  | { mode: "household"; householdScope: string }
  | { mode: "scope"; owner: QueueOwner }
  | { mode: "generation"; ownerId: string; throughGeneration: number }
  | { mode: "device"; ownerId: string };
const QUEUE_STORE_ENVELOPE = "herewoven.queue-store.v2";
export type OwnedQueueEnvelope =
  | {
      v: 2;
      envelope: typeof QUEUE_STORE_ENVELOPE;
      state: "active";
      owner: QueueOwner;
      runtime: string;
      queue: string;
      reviewIds?: string[];
    }
  | { v: 2; envelope: typeof QUEUE_STORE_ENVELOPE; state: "retired" };
export const RETIRED_QUEUE_ENVELOPE = JSON.stringify({
  v: 2,
  envelope: QUEUE_STORE_ENVELOPE,
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

const SCOPE = /^[a-f0-9]{64}$/;
const REVIEW_ID = /^[A-Za-z0-9_-]{16,128}$/;
const isOwnerId = (value: unknown): value is string =>
  isStringLength(value, 1, 128);
const isReviewId = (value: unknown): value is string =>
  matchesPattern(value, REVIEW_ID);

function queueOwner(value: unknown): QueueOwner | null {
  const record = strictRecord(value, [
    "kind",
    "ownerId",
    "scope",
    "generation",
    "householdScope",
  ]);
  if (!record) return null;
  const { kind, ownerId, scope, generation, householdScope } = record;
  if (
    !isOneOf(kind, ["person", "device"] as const) ||
    !isOwnerId(ownerId) ||
    !matchesPattern(scope, SCOPE) ||
    !isNonNegativeSafeInteger(generation) ||
    !matchesPattern(householdScope, SCOPE)
  )
    return null;
  return { kind, ownerId, scope, generation, householdScope };
}

/** A discriminated-union member: the tag selects the member's known keys. */
function tagged(value: unknown, tag: string) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;
  return (value as Record<string, unknown>)[tag];
}

export function parseQueueOwner(value: unknown): ShapeResult<QueueOwner> {
  const owner = queueOwner(value);
  return owner ? shapeSuccess(owner) : SHAPE_FAILURE;
}

export function parseQueueOwnerResponse(
  value: unknown,
): ShapeResult<QueueOwnerResponse> {
  const enabled = tagged(value, "enabled");
  const record = strictRecord(value, ["contract", "enabled", "owner"]);
  if (!record || record.contract !== QUEUE_OWNER_CONTRACT) return SHAPE_FAILURE;
  if (enabled === true) {
    const owner = queueOwner(record.owner);
    return owner
      ? shapeSuccess({ contract: QUEUE_OWNER_CONTRACT, enabled, owner })
      : SHAPE_FAILURE;
  }
  if (enabled !== false) return SHAPE_FAILURE;
  if (!("owner" in record))
    return shapeSuccess({ contract: QUEUE_OWNER_CONTRACT, enabled });
  if (record.owner === undefined)
    return shapeSuccess({
      contract: QUEUE_OWNER_CONTRACT,
      enabled,
      owner: undefined,
    });
  const owner = queueOwner(record.owner);
  return owner
    ? shapeSuccess({ contract: QUEUE_OWNER_CONTRACT, enabled, owner })
    : SHAPE_FAILURE;
}

export function parseQueueRetirement(
  value: unknown,
): ShapeResult<QueueRetirement> {
  switch (tagged(value, "mode")) {
    case "household": {
      const record = strictRecord(value, ["mode", "householdScope"]);
      return record && matchesPattern(record.householdScope, SCOPE)
        ? shapeSuccess({
            mode: "household",
            householdScope: record.householdScope,
          })
        : SHAPE_FAILURE;
    }
    case "scope": {
      const record = strictRecord(value, ["mode", "owner"]);
      const owner = record && queueOwner(record.owner);
      return owner ? shapeSuccess({ mode: "scope", owner }) : SHAPE_FAILURE;
    }
    case "generation": {
      const record = strictRecord(value, [
        "mode",
        "ownerId",
        "throughGeneration",
      ]);
      return record &&
        isOwnerId(record.ownerId) &&
        isNonNegativeSafeInteger(record.throughGeneration)
        ? shapeSuccess({
            mode: "generation",
            ownerId: record.ownerId,
            throughGeneration: record.throughGeneration,
          })
        : SHAPE_FAILURE;
    }
    case "device": {
      const record = strictRecord(value, ["mode", "ownerId"]);
      return record && isOwnerId(record.ownerId)
        ? shapeSuccess({ mode: "device", ownerId: record.ownerId })
        : SHAPE_FAILURE;
    }
    default:
      return SHAPE_FAILURE;
  }
}

export function parseOwnedQueueEnvelope(
  value: unknown,
): ShapeResult<OwnedQueueEnvelope> {
  const state = tagged(value, "state");
  if (state === "retired") {
    const record = strictRecord(value, ["v", "envelope", "state"]);
    return record && record.v === 2 && record.envelope === QUEUE_STORE_ENVELOPE
      ? shapeSuccess({ v: 2, envelope: QUEUE_STORE_ENVELOPE, state })
      : SHAPE_FAILURE;
  }
  if (state !== "active") return SHAPE_FAILURE;
  const record = strictRecord(value, [
    "v",
    "envelope",
    "state",
    "owner",
    "runtime",
    "queue",
    "reviewIds",
  ]);
  if (!record) return SHAPE_FAILURE;
  const owner = queueOwner(record.owner);
  const { runtime, queue } = record;
  if (
    record.v !== 2 ||
    record.envelope !== QUEUE_STORE_ENVELOPE ||
    !owner ||
    !isStringLength(runtime, 16, 128) ||
    !isStringLength(queue, 1, Number.POSITIVE_INFINITY)
  )
    return SHAPE_FAILURE;
  const base: OwnedQueueEnvelope & { state: "active" } = {
    v: 2,
    envelope: QUEUE_STORE_ENVELOPE,
    state,
    owner,
    runtime,
    queue,
  };
  if (!("reviewIds" in record)) return shapeSuccess(base);
  if (record.reviewIds === undefined)
    return shapeSuccess({ ...base, reviewIds: undefined });
  const reviewIds = arrayOf(record.reviewIds, 50, isReviewId);
  return reviewIds ? shapeSuccess({ ...base, reviewIds }) : SHAPE_FAILURE;
}
