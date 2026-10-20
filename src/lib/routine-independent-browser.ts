/** Person-only browser binding. Owner retirement includes this separate scope. */
import { queueStoreCandidates, type StorageLike } from "@/lib/offline-queue";
import { ownedQueueLocation } from "@/lib/owned-queue-persistence";
import { OwnedRequestRecoveryError } from "@/lib/owned-request-journal";
import { createIndependentRecoveryStore } from "@/lib/routine-independent-store";
import {
  readIndependentRecoveryContext,
  readIndependentRecoveryReview,
} from "@/lib/routine-independent-client";
import { newIdempotencyKey } from "@/lib/idempotency-key";
export function browserIndependentRecovery(original: {
  userId: string;
  familyId: string;
}) {
  let localStorage: StorageLike | null = null,
    indexedDB: IDBFactory | null = null;
  try {
    if (typeof window !== "undefined") localStorage = window.localStorage;
  } catch {
    /* Explicit storage hold, never an unowned fallback. */
  }
  try {
    if (typeof window !== "undefined") indexedDB = window.indexedDB ?? null;
  } catch {
    /* Candidate probing reports unavailable. */
  }
  return createIndependentRecoveryStore({
    runtime: newIdempotencyKey(),
    resolveContext: async () => {
      const context = await readIndependentRecoveryContext();
      if (
        context.userId !== original.userId ||
        context.familyId !== original.familyId
      )
        throw new OwnedRequestRecoveryError("OWNER_CHANGED");
      return context;
    },
    candidates: (owner) =>
      queueStoreCandidates(ownedQueueLocation(owner), {
        localStorage,
        indexedDB,
      }).candidates,
    reviewRecovered: async (entry, context) =>
      (await readIndependentRecoveryReview(entry, context)).canRetry,
  });
}
