/** Explicit foreground I/O only. Never auto-send, refresh a proof, change a key,
 * drop a pending request or infer no effect from an HTTP/refusal/missing receipt. */
import { requestOwnedJson as request } from "../owned-request-http";
import { newIdempotencyKey } from "../idempotency-key";
import { hashBrowserIdempotentRequest } from "../idempotency-request-json";
import {
  FOOD_APPLY_ACTION,
  reviewedFoodWrite,
  foodApplyReceipt,
  foodApplyReceiptMatches,
  type ReviewedFoodWrite,
} from "./apply-contract";
import {
  FOOD_RECOVERY,
  FOOD_OWNER_HEADER,
  foodRecoveryContext,
  foodRecoveryEntry,
  foodRecoveryReply,
  foodEntryMatchesContext,
  type FoodRecoveryContext,
  type FoodRecoveryEntry,
} from "./recovery-contract";
export async function readFoodRecoveryContext() {
  const result = await request("/api/assistant/food/context", {}, 16384);
  if (result.kind !== "reply" || !result.response.ok)
    throw new Error("Food recovery unavailable");
  return foodRecoveryContext.parse(result.body);
}
export function makeFoodIntent(
  command: ReviewedFoodWrite,
  context: FoodRecoveryContext,
  key = newIdempotencyKey(),
): FoodRecoveryEntry {
  const entry = foodRecoveryEntry.parse({
    kind: "food-plan",
    key,
    body: JSON.stringify(reviewedFoodWrite.parse(command)),
  });
  if (
    !context.enabled ||
    !context.owner ||
    !foodEntryMatchesContext(entry, context)
  )
    throw new Error("Food request owner changed or saving paused");
  return entry;
}
export async function inspectFoodIntent(
  entry: FoodRecoveryEntry,
  context: FoodRecoveryContext,
) {
  foodRecoveryEntry.parse(entry);
  if (!context.owner || !foodEntryMatchesContext(entry, context))
    throw new Error("Food request owner changed");
  const result = await request(
    "/api/assistant/food/inspect",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [FOOD_OWNER_HEADER]: context.owner.scope,
      },
      body: JSON.stringify({ contract: FOOD_RECOVERY, entry }),
    },
    262144,
  );
  if (result.kind !== "reply" || !result.response.ok)
    throw new Error("Food recovery unavailable");
  const proof = foodRecoveryReply.parse(result.body);
  const command = reviewedFoodWrite.parse(JSON.parse(entry.body));
  const requestHash = await hashBrowserIdempotentRequest(
    FOOD_APPLY_ACTION,
    command,
  );
  if (
    !requestHash ||
    proof.ownerScope !== context.owner.scope ||
    proof.entry.key !== entry.key ||
    proof.entry.body !== entry.body ||
    proof.requestHash !== requestHash
  )
    throw new Error("Food recovery proof changed");
  return {
    ...proof,
    retryEligible:
      proof.canRetry &&
      context.enabled &&
      proof.retryUntil !== null &&
      Date.now() < Date.parse(proof.retryUntil),
  };
}
/** Caller must durably stage first and own the journal lease. Recovered entries
 * require inspectFoodIntent/reviewRecovered before a deliberate exact retry. */
export async function sendFoodIntent(
  entry: FoodRecoveryEntry,
  context: FoodRecoveryContext,
) {
  foodRecoveryEntry.parse(entry);
  if (
    !context.enabled ||
    !context.owner ||
    !foodEntryMatchesContext(entry, context)
  )
    throw new Error("Food request owner changed or saving paused");
  const command = reviewedFoodWrite.parse(JSON.parse(entry.body));
  const result = await request(
    "/api/assistant/food/apply",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": entry.key,
        [FOOD_OWNER_HEADER]: context.owner.scope,
      },
      body: entry.body,
    },
    16384,
  );
  if (
    result.kind !== "reply" ||
    result.response.status !== 201 ||
    !foodApplyReceiptMatches(result.body, command)
  )
    return { kind: "unknown" as const };
  return {
    kind: "confirmed" as const,
    receipt: foodApplyReceipt.parse(result.body),
  };
}
