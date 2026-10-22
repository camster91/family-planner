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
) {
  const reply = await requestOwnedJson(
    `/api/review-documents/context?domain=${domain}`,
    {},
    8192,
  );
  if (reply.kind === "reply" && [401, 403, 409].includes(reply.response.status))
    throw new OwnedRequestRecoveryError("OWNER_CHANGED");
  if (reply.kind !== "reply" || !reply.response.ok)
    throw new OwnedRequestRecoveryError("UNAVAILABLE");
  const context = reviewDocumentContext.safeParse(reply.body);
  if (!context.success || context.data.domain !== domain)
    throw new OwnedRequestRecoveryError("OWNER_CHANGED");
  return context.data;
}
export function browserReviewDocument(
  original: Pick<ReviewDocumentContext, "userId" | "familyId" | "domain">,
) {
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
      const context = await readReviewDocumentContext(original.domain);
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
