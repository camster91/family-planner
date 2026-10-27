import { RECIPE_OWNER_HEADER, readRecipeOwner, sameRecipeOwner, type RecipeOwner } from "@/lib/recipe-owner-contract";
import { queueStoreCandidates, type StorageLike } from "@/lib/offline-queue";
import { ownedQueueLocation } from "@/lib/owned-queue-persistence";
import { OwnedRequestRecoveryError } from "@/lib/owned-request-journal";
import { newIdempotencyKey } from "@/lib/idempotency-key";
import { requestOwnedJson } from "@/lib/owned-request-http";
import { createReviewDocumentStore } from "@/lib/review-document-store";
import {
  reviewDocumentContext,
  type ReviewDocumentContext,
} from "@/lib/review-document-contract";

export async function readReviewDocumentContext(
  domain: ReviewDocumentContext["domain"],
  expectedRecipeOwner?: RecipeOwner,
) {
  const reply = await requestOwnedJson(
    `/api/review-documents/context?domain=${domain}`,
    expectedRecipeOwner ? { headers: { [RECIPE_OWNER_HEADER]: JSON.stringify(expectedRecipeOwner) } } : {},
    8192,
  );
  if (reply.kind === "reply" && [401, 403, 409].includes(reply.response.status))
    throw new OwnedRequestRecoveryError("OWNER_CHANGED");
  if (reply.kind !== "reply" || !reply.response.ok)
    throw new OwnedRequestRecoveryError("UNAVAILABLE");
  if (expectedRecipeOwner && (domain !== "recipe" || !sameRecipeOwner(expectedRecipeOwner,
      readRecipeOwner(reply.response.headers?.get(RECIPE_OWNER_HEADER) ?? null))))
    throw new OwnedRequestRecoveryError("OWNER_CHANGED");
  const context = reviewDocumentContext.safeParse(reply.body);
  if (!context.success || context.data.domain !== domain || (expectedRecipeOwner && (
      context.data.userId !== expectedRecipeOwner.actorId || context.data.familyId !== expectedRecipeOwner.familyId ||
      context.data.role !== expectedRecipeOwner.role)))
    throw new OwnedRequestRecoveryError("OWNER_CHANGED");
  return context.data;
}
export function browserReviewDocument(
  original: Pick<ReviewDocumentContext, "userId" | "familyId" | "domain">,
  expectedRecipeOwner?: RecipeOwner,
) {
  const frozenRecipeOwner = expectedRecipeOwner ? Object.freeze({ ...expectedRecipeOwner }) : undefined;
  let localStorage: StorageLike | null = null,
    indexedDB: IDBFactory | null = null;
  try {
    if (typeof window !== "undefined") localStorage = window.localStorage;
  } catch {
    /* Hold. */
  }
  try {
    if (typeof window !== "undefined") indexedDB = window.indexedDB ?? null;
  } catch {
    /* Hold. */
  }
  return createReviewDocumentStore({
    runtime: newIdempotencyKey(),
    now: Date.now,
    resolveContext: async () => {
      const context = await readReviewDocumentContext(original.domain, frozenRecipeOwner);
      if (
        context.userId !== original.userId ||
        context.familyId !== original.familyId
      )
        throw new OwnedRequestRecoveryError("OWNER_CHANGED");
      return context;
    },
    candidates: (owner) => {
      // Do not mistake an inaccessible replica for an empty draft.
      if (!localStorage || !indexedDB)
        throw new OwnedRequestRecoveryError("UNAVAILABLE");
      return queueStoreCandidates(ownedQueueLocation(owner), {
        localStorage,
        indexedDB,
      }).candidates;
    },
  });
}
