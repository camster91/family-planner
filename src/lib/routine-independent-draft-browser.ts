import { queueStoreCandidates, type StorageLike } from "@/lib/offline-queue";
import { ownedQueueLocation } from "@/lib/owned-queue-persistence";
import { OwnedRequestRecoveryError } from "@/lib/owned-request-journal";
import { newIdempotencyKey } from "@/lib/idempotency-key";
import { readIndependentDraftContext } from "@/lib/routine-independent-client";
import { createIndependentDraftStore } from "@/lib/routine-independent-draft-store";
export function browserIndependentDraft(original: {
  userId: string;
  familyId: string;
}) {
  let localStorage: StorageLike | null = null,
    indexedDB: IDBFactory | null = null;
  try {
    if (typeof window !== "undefined") localStorage = window.localStorage;
  } catch {
    /* Explicit hold, never unowned fallback. */
  }
  try {
    if (typeof window !== "undefined") indexedDB = window.indexedDB ?? null;
  } catch {
    /* Storage probing handles this candidate. */
  }
  return createIndependentDraftStore({
    runtime: newIdempotencyKey(),
    resolveContext: async () => {
      const context = await readIndependentDraftContext();
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
  });
}
