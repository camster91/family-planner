import {
  createOwnedRequestJournal,
  OwnedRequestRecoveryError,
} from "@/lib/owned-request-journal";
import { queueStoreCandidates, type StorageLike } from "@/lib/offline-queue";
import { ownedQueueLocation } from "@/lib/owned-queue-persistence";
import { newIdempotencyKey } from "@/lib/idempotency-key";
import {
  readResponsibilityContext,
  inspectResponsibility,
} from "@/lib/responsibility-client";
import {
  responsibilityRecoveryContext,
  responsibilityRecoveryEntry,
  responsibilityRecoveryJournal,
  responsibilityEntryMatchesContext,
  RESPONSIBILITY_RECOVERY,
} from "@/lib/responsibility-recovery";
export function browserResponsibilityRecovery(original: {
  userId: string;
  familyId: string;
}) {
  let localStorage: StorageLike | null = null,
    indexedDB: IDBFactory | null = null;
  try {
    localStorage = window.localStorage;
  } catch {
    /* Fail closed in the owned store. */
  }
  try {
    indexedDB = window.indexedDB ?? null;
  } catch {
    /* Explicit storage hold. */
  }
  return createOwnedRequestJournal({
    runtime: newIdempotencyKey(),
    context: responsibilityRecoveryContext,
    entry: responsibilityRecoveryEntry,
    journal: responsibilityRecoveryJournal,
    contract: RESPONSIBILITY_RECOVERY,
    maxBytes: 128 * 1024,
    matchesContext: responsibilityEntryMatchesContext,
    resolveContext: async () => {
      const context = await readResponsibilityContext();
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
      (await inspectResponsibility(entry, context)).canRetry,
  });
}
