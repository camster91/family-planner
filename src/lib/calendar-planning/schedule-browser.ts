import {
  createOwnedRequestJournal,
  OwnedRequestRecoveryError,
} from "@/lib/owned-request-journal";
import { queueStoreCandidates, type StorageLike } from "@/lib/offline-queue";
import { ownedQueueLocation } from "@/lib/owned-queue-persistence";
import { newIdempotencyKey } from "@/lib/idempotency-key";
import { readScheduleContext, inspectSchedule } from "./schedule-client";
import {
  scheduleRecoveryContext,
  scheduleRecoveryEntry,
  scheduleRecoveryJournal,
  scheduleEntryMatchesContext,
  SCHEDULE_RECOVERY,
} from "./schedule-recovery";
export function browserScheduleRecovery(original: {
  userId: string;
  familyId: string;
}) {
  let localStorage: StorageLike | null = null,
    indexedDB: IDBFactory | null = null;
  try {
    localStorage = window.localStorage;
  } catch {
    /* Keep an explicit storage hold. */
  }
  try {
    indexedDB = window.indexedDB ?? null;
  } catch {
    /* No unowned fallback. */
  }
  return createOwnedRequestJournal({
    runtime: newIdempotencyKey(),
    context: scheduleRecoveryContext,
    entry: scheduleRecoveryEntry,
    journal: scheduleRecoveryJournal,
    contract: SCHEDULE_RECOVERY,
    maxBytes: 256 * 1024,
    matchesContext: scheduleEntryMatchesContext,
    resolveContext: async () => {
      const context = await readScheduleContext();
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
      (await inspectSchedule(entry, context)).canRetry,
  });
}
