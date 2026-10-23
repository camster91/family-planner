/** Person-only browser binding. Owner retirement includes this separate scope. */
import { queueStoreCandidates, type StorageLike } from "@/lib/offline-queue";
import { ownedQueueLocation } from "@/lib/owned-queue-persistence";
import { OwnedRequestRecoveryError } from "@/lib/owned-request-journal";
import { createRoutineRecoveryStore } from "@/lib/routine-schedule-recovery-store";
import {
  readRoutineRecoveryContext,
  readRoutineRecoveryReview,
} from "@/lib/routine-schedule-client";
import { newIdempotencyKey } from "@/lib/idempotency-key";
export function browserRoutineRecovery(original: {
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
  return createRoutineRecoveryStore({
    runtime: newIdempotencyKey(),
    resolveContext: async () => {
      const context = await readRoutineRecoveryContext();
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
      (await readRoutineRecoveryReview(entry, context)).canRetry,
  });
}
