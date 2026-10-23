/** Foreground, state-only receipt reads. Never send or prune saved requests. */
import { z } from "zod";
import { hashBrowserIdempotentRequest } from "@/lib/idempotency-request-json";
import { createRecipeSchema } from "@/lib/recipe-input-contract";
import { captureGrocerySchema } from "@/lib/capture-grocery-contract";
import { createEventSchema, createChoreSchema } from "@/lib/validations";
import { profileChoreCreateSchema } from "@/lib/profile-chore-create-contract";
import { requestOwnedJson } from "@/lib/owned-request-http";
import { OwnedRequestRecoveryError } from "@/lib/owned-request-journal";
import type {
  ReviewExactRequest,
  ReviewDocumentContext,
} from "@/lib/review-document-contract";
import type { ReviewReceiptState } from "@/lib/review-document-store";
const receipt = z.union([
  z
    .object({
      state: z.literal("refused"),
      reason: z.enum(["source-exists", "source-check-unavailable"]),
    })
    .strict(),
  z.object({ state: z.enum(["absent", "pending", "expired"]) }).strict(),
  z
    .object({
      state: z.literal("committed"),
      current: z.enum(["present", "removed", "unknown"]),
    })
    .strict(),
]);
export async function inspectReviewDocumentReceipt(
  request: ReviewExactRequest,
  context: ReviewDocumentContext,
): Promise<ReviewReceiptState> {
  if (
    !context.owner ||
    context.owner.ownerId !== context.userId ||
    (request.action === "recipe.create") !== (context.domain === "recipe")
  )
    throw new OwnedRequestRecoveryError("OWNER_CHANGED");
  const body: unknown = JSON.parse(request.body);
  // Hash parsed canonical input exactly as the corresponding create route does,
  // including defaults/normalization, without replacing the saved wire body.
  const parsed =
    request.action === "recipe.create"
      ? createRecipeSchema.parse(body)
      : request.action === "event.create"
        ? createEventSchema.parse(body)
        : request.action === "chore.create"
          ? createChoreSchema.parse(body)
          : request.action === "chore.profile.create"
            ? profileChoreCreateSchema.parse(body)
            : captureGrocerySchema.parse(body);
  const hash = await hashBrowserIdempotentRequest(request.action, parsed);
  if (!/^[a-f0-9]{64}$/.test(hash))
    throw new OwnedRequestRecoveryError("UNAVAILABLE");
  const recipe = request.action === "recipe.create";
  const chore =
    request.action === "chore.create" ||
    request.action === "chore.profile.create";
  if (chore && context.role !== "parent")
    throw new OwnedRequestRecoveryError("OWNER_CHANGED");
  const headers = new Headers({ "Idempotency-Key": request.key });
  if (recipe) headers.set("X-Recipe-Request-Hash", hash);
  else if (chore) {
    headers.set("X-Chore-Create-Action", request.action);
    headers.set("X-Chore-Request-Hash", hash);
  } else {
    headers.set("X-Capture-Action", request.action);
    headers.set("X-Capture-Request-Hash", hash);
  }
  const result = await requestOwnedJson(
    recipe
      ? "/api/recipes/receipt"
      : chore
        ? "/api/chores/create/receipt"
        : "/api/capture/receipt",
    { headers },
    8192,
  );
  if (result.kind !== "reply")
    throw new OwnedRequestRecoveryError("UNAVAILABLE");
  if ([401, 403, 409, 422].includes(result.response.status))
    return { state: "refused" };
  if (!result.response.ok) throw new OwnedRequestRecoveryError("UNAVAILABLE");
  const proof = receipt.safeParse(result.body);
  if (!proof.success) throw new OwnedRequestRecoveryError("UPDATE_REQUIRED");
  return proof.data;
}
