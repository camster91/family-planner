/** Isolated owned food request journal; uses existing storage/retirement leases. */
import {
  createOwnedRequestJournal,
  OwnedRequestRecoveryError,
} from "../owned-request-journal";
import { queueStoreCandidates, type StorageLike } from "../offline-queue";
import { ownedQueueLocation } from "../owned-queue-persistence";
import { newIdempotencyKey } from "../idempotency-key";
import { readFoodRecoveryContext, inspectFoodIntent } from "./client";
import {
  FOOD_RECOVERY,
  foodRecoveryContext,
  foodJournalEntry,
  foodRecoveryJournal,
  foodJournalMatchesContext,
} from "./recovery-contract";
export function browserFoodRecovery(original: {
  userId: string;
  familyId: string;
}) {
  let localStorage: StorageLike | null = null,
    indexedDB: IDBFactory | null = null;
  try {
    localStorage = window.localStorage;
  } catch {
    /* Preserve an explicit storage hold. */
  }
  try {
    indexedDB = window.indexedDB ?? null;
  } catch {
    /* No unowned fallback. */
  }
  return createOwnedRequestJournal({
    runtime: newIdempotencyKey(),
    context: foodRecoveryContext,
    entry: foodJournalEntry,
    journal: foodRecoveryJournal,
    contract: FOOD_RECOVERY,
    maxBytes: 768 * 1024,
    matchesContext: foodJournalMatchesContext,
    localDraftKind: "local-food-draft",
    reviewBeforeEverySend: true,
    resolveContext: async () => {
      const context = await readFoodRecoveryContext();
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
      entry.kind === "food-plan" &&
      (await inspectFoodIntent(entry, context)).retryEligible,
  });
}
