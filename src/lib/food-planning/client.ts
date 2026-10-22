import {
  foodOptionsQuery,
  foodOptionsReply,
  type FoodOptionsQuery,
} from "./options-contract";
import { sameQueueOwner } from "../queue-owner-contract";
import { foodPreviewRequest } from "./contract";
import { foodPreviewView, foodReviewView } from "./view-contract";
import { canonicalRequestJson } from "../idempotency-request-json";
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
export class FoodRecipeScopeRequired extends Error {
  constructor() {
    super("Choose an explicit recipe pool");
  }
}
function requireRecipePool(result: { kind: string; body?: unknown }) {
  const body = result.body;
  if (
    result.kind === "reply" &&
    body &&
    typeof body === "object" &&
    "error" in body
  ) {
    const error = body.error;
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "RECIPES_FILTER_REQUIRED"
    )
      throw new FoodRecipeScopeRequired();
  }
}
export class FoodOwnerChanged extends Error {
  constructor() {
    super("Food view owner changed");
  }
}
export async function readFoodRecoveryContext() {
  const result = await request("/api/assistant/food/context", {}, 16384);
  if (result.kind === "reply" && [401, 403].includes(result.response.status))
    throw new FoodOwnerChanged();
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

/** Fresh read only. Edited alternatives must be sent through this query again. */
export async function readFoodPreview(
  query: import("./contract").FoodPreviewRequest,
  context: FoodRecoveryContext,
) {
  const input = foodPreviewRequest.parse(query);
  const result = await request(
    "/api/assistant/food",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
    262144,
  );
  requireRecipePool(result);
  if (result.kind !== "reply" || !result.response.ok)
    throw new Error("Food preview unavailable");
  const view = foodPreviewView.parse(result.body);
  requireViewOwner(view.owner, context);
  for (const row of view.plan.slots) {
    const slot = input.plan.slots.find((slot) => slot.key === row.key);
    if (
      !slot ||
      [row.choice, ...row.alternatives].some(
        (choice) =>
          choice &&
          (choice.servings !== slot.servings ||
            (input.recipeIds && !input.recipeIds.includes(choice.recipeId))),
      ) ||
      (row.choice && slot.recipeId && row.choice.recipeId !== slot.recipeId)
    )
      throw new Error("Food preview choices changed");
  }
  if (
    canonicalRequestJson(view.sourceRequest) !== canonicalRequestJson(input) ||
    view.recipeScope !== (input.recipeIds ? "selected" : "library") ||
    view.plan.slots.length !== input.plan.slots.length ||
    view.plan.slots.some(
      (row) => !input.plan.slots.some((slot) => slot.key === row.key),
    )
  )
    throw new Error("Food preview scope changed");
  await renewFoodReadOwner(view.owner, context);
  return view;
}
export async function readFoodWriteReview(
  command: ReviewedFoodWrite,
  context: FoodRecoveryContext,
) {
  const input = reviewedFoodWrite.parse(command);
  const result = await request(
    "/api/assistant/food/review",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
    262144,
  );
  requireRecipePool(result);
  if (result.kind !== "reply" || !result.response.ok)
    throw new Error("Food review unavailable");
  const view = foodReviewView.parse(result.body);
  requireViewOwner(view.owner, context);
  if (
    canonicalRequestJson({ ...view.input, reviewProof: undefined }) !==
    canonicalRequestJson({ ...input, reviewProof: undefined })
  )
    throw new Error("Food review command changed");
  await renewFoodReadOwner(view.owner, context);
  return view;
}
function requireViewOwner(
  owner: import("./view-contract").FoodPreviewView["owner"],
  context: FoodRecoveryContext,
) {
  if (
    !context.owner ||
    owner.userId !== context.userId ||
    owner.familyId !== context.familyId ||
    owner.role !== context.role ||
    owner.generation !== context.owner.generation
  )
    throw new FoodOwnerChanged();
}

/** A delayed private read belongs only to the original current person scope. */
async function renewFoodReadOwner(
  owner: import("./view-contract").FoodPreviewView["owner"],
  original: FoodRecoveryContext,
) {
  const current = await readFoodRecoveryContext();
  if (
    !original.owner ||
    !current.owner ||
    !sameQueueOwner(original.owner, current.owner)
  )
    throw new FoodOwnerChanged();
  requireViewOwner(owner, current);
}

/** Read options stay query/owner-bound; nothing is persisted until selection. */
export async function readFoodOptions(
  query: FoodOptionsQuery,
  context: FoodRecoveryContext,
) {
  if (!context.owner) throw new FoodOwnerChanged();
  const input = foodOptionsQuery.parse(query);
  const result = await request(
    "/api/assistant/food/options",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [FOOD_OWNER_HEADER]: context.owner.scope,
      },
      body: JSON.stringify(input),
    },
    131072,
  );
  if (result.kind === "reply" && [401, 403].includes(result.response.status))
    throw new FoodOwnerChanged();
  if (result.kind !== "reply" || !result.response.ok)
    throw new Error("Food choices unavailable");
  const reply = foodOptionsReply.parse(result.body);
  requireViewOwner(reply.owner, context);
  if (canonicalRequestJson(reply.query) !== canonicalRequestJson(input))
    throw new Error("Food choices query changed");
  await renewFoodReadOwner(reply.owner, context);
  return reply;
}
