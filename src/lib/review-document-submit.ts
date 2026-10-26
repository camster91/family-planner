import { RECIPE_OWNER_HEADER, type RecipeOwner } from "@/lib/recipe-owner-contract";
import {
  REVIEW_DOCUMENT_CONTRACT,
  type ReviewExactRequest,
  type ReviewDocumentContext,
} from "@/lib/review-document-contract";
import {
  REVIEW_SUBMIT_HEADERS as H,
  reviewSubmitDomain,
} from "@/lib/review-document-submit-contract";
import { OwnedRequestRecoveryError } from "@/lib/owned-request-journal";
import { requestOwnedJson } from "@/lib/owned-request-http";

export function submitReviewDocumentRequest(
  request: ReviewExactRequest,
  context: ReviewDocumentContext,
  expiresAt: number,
  expectedRecipeOwner?: RecipeOwner,
) {
  if (
    ((request.action === "chore.create" ||
      request.action === "chore.profile.create") &&
      context.role !== "parent") ||
    !context.enabled ||
    !context.owner ||
    context.domain !== reviewSubmitDomain(request.action)
  )
    throw new OwnedRequestRecoveryError("DISABLED");
  return requestOwnedJson("/api/review-documents/submit", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": request.key,
      [H.contract]: REVIEW_DOCUMENT_CONTRACT,
      [H.owner]: context.owner.scope,
      [H.action]: request.action,
      [H.expires]: String(expiresAt),
      ...(request.action === "recipe.create" && expectedRecipeOwner ? { [RECIPE_OWNER_HEADER]: JSON.stringify(expectedRecipeOwner) } : {}),
    },
    body: request.body,
  });
}
