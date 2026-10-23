import {
  createOwnedRequestJournal,
  OwnedRequestRecoveryError,
} from "@/lib/owned-request-journal";
import { queueStoreCandidates, type StorageLike } from "@/lib/offline-queue";
import { ownedQueueLocation } from "@/lib/owned-queue-persistence";
import { newIdempotencyKey } from "@/lib/idempotency-key";
import {
  readWeeklyResetContext,
  inspectWeeklyReset,
} from "@/lib/weekly-reset-client";
import {
  weeklyResetRecoveryContext,
  weeklyResetRecoveryEntry,
  weeklyResetRecoveryJournal,
  weeklyResetEntryMatchesContext,
  WEEKLY_RESET_RECOVERY,
} from "@/lib/weekly-reset-recovery";
export function browserWeeklyResetRecovery(original: {
  userId: string;
  familyId: string;
}) {
  let localStorage: StorageLike | null = null,
    indexedDB: IDBFactory | null = null;
  try {
    localStorage = window.localStorage;
  } catch {
    /* Owned storage hold. */
  }
  try {
    indexedDB = window.indexedDB ?? null;
  } catch {
    /* Probe reports hold. */
  }
  return createOwnedRequestJournal({
    runtime: newIdempotencyKey(),
    context: weeklyResetRecoveryContext,
    entry: weeklyResetRecoveryEntry,
    journal: weeklyResetRecoveryJournal,
    contract: WEEKLY_RESET_RECOVERY,
    maxBytes: 32768,
    matchesContext: weeklyResetEntryMatchesContext,
    resolveContext: async () => {
      const context = await readWeeklyResetContext();
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
      (await inspectWeeklyReset(entry, context)).canRetry,
  });
}
