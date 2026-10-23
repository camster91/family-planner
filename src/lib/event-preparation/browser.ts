import {
  createOwnedRequestJournal,
  OwnedRequestRecoveryError,
} from "@/lib/owned-request-journal";
import { queueStoreCandidates, type StorageLike } from "@/lib/offline-queue";
import { ownedQueueLocation } from "@/lib/owned-queue-persistence";
import { newIdempotencyKey } from "@/lib/idempotency-key";
import { readPreparationContext, inspectPreparation } from "./client";
import {
  preparationRecoveryContext,
  preparationRecoveryEntry,
  preparationRecoveryJournal,
  preparationEntryMatchesContext,
  PREPARATION_RECOVERY,
  PREPARATION_JOURNAL_BYTES,
} from "./recovery";
export function browserPreparationRecovery(original: {
  userId: string;
  familyId: string;
}) {
  let localStorage: StorageLike | null = null,
    indexedDB: IDBFactory | null = null;
  try {
    localStorage = window.localStorage;
  } catch {
    /* Explicit storage hold. */
  }
  try {
    indexedDB = window.indexedDB ?? null;
  } catch {
    /* Never fall back to unowned state. */
  }
  return createOwnedRequestJournal({
    runtime: newIdempotencyKey(),
    context: preparationRecoveryContext,
    entry: preparationRecoveryEntry,
    journal: preparationRecoveryJournal,
    contract: PREPARATION_RECOVERY,
    maxBytes: PREPARATION_JOURNAL_BYTES,
    matchesContext: preparationEntryMatchesContext,
    resolveContext: async () => {
      const context = await readPreparationContext();
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
      (await inspectPreparation(entry, context)).canRetry,
  });
}
