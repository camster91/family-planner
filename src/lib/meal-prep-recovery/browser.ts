/** One owned CAS journal for an editable bulk draft and frozen exact requests. */
import {
  createOwnedRequestJournal,
  OwnedRequestRecoveryError,
} from "../owned-request-journal";
import { queueStoreCandidates, type StorageLike } from "../offline-queue";
import { ownedQueueLocation } from "../owned-queue-persistence";
import { newIdempotencyKey } from "../idempotency-key";
import { PREP_RECOVERY, prepContext } from "./contract";
import {
  prepJournal,
  prepJournalEntry,
  prepJournalMatchesContext,
} from "./draft-contract";
import { readPrepContext, inspectPrepIntent } from "./client";
export function browserPrepRecovery(original: {
  userId: string;
  familyId: string;
}) {
  let localStorage: StorageLike | null = null,
    indexedDB: IDBFactory | null = null;
  try {
    localStorage = window.localStorage;
  } catch {
    /* Explicit unavailable hold. */
  }
  try {
    indexedDB = window.indexedDB ?? null;
  } catch {
    /* No unowned fallback. */
  }
  return createOwnedRequestJournal({
    runtime: newIdempotencyKey(),
    context: prepContext,
    entry: prepJournalEntry,
    journal: prepJournal,
    contract: PREP_RECOVERY,
    maxBytes: 768 * 1024,
    matchesContext: prepJournalMatchesContext,
    localDraftKind: "local-prep-draft",
    reviewBeforeEverySend: true,
    resolveContext: async () => {
      const context = await readPrepContext();
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
      entry.kind === "meal-prep" &&
      (await inspectPrepIntent(entry, context)).retryEligible,
  });
}
