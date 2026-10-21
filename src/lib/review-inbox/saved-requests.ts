/** Browser-only adapter. Raw exact requests stay inside their original stores;
 * the inbox receives fixed labels, timestamps and allowlisted recovery URLs. */
import { readOwnedRequestSnapshot } from "@/lib/owned-request-snapshot";
import { OwnedRequestRecoveryError } from "@/lib/owned-request-journal";
import { ownedQueueLocation } from "@/lib/owned-queue-persistence";
import { queueStoreCandidates, type StorageLike } from "@/lib/offline-queue";
import { readPreparationContext } from "@/lib/event-preparation/client";
import {
  preparationRecoveryContext,
  preparationRecoveryJournal,
  preparationEntryMatchesContext,
  PREPARATION_JOURNAL_BYTES,
  type PreparationRecoveryContext,
  type PreparationRecoveryEntry,
} from "@/lib/event-preparation/recovery";
import { preparationCommand } from "@/lib/event-preparation/contract";
import { preparationRequestHash } from "@/lib/event-preparation/request-hash";
import { readScheduleContext } from "@/lib/calendar-planning/schedule-client";
import {
  scheduleRecoveryContext,
  scheduleRecoveryJournal,
  scheduleEntryMatchesContext,
  type ScheduleRecoveryContext,
  type ScheduleRecoveryEntry,
} from "@/lib/calendar-planning/schedule-recovery";
import { scheduleMoveCommand } from "@/lib/calendar-planning/conflict-review";
export type SavedReviewKind = "preparation" | "schedule";
export type SavedReviewItem = {
  id: string;
  kind: SavedReviewKind;
  issuedAt: string;
  href: string;
};
export async function readSavedReviewRequests(
  kind: SavedReviewKind,
  expected: { userId: string; familyId: string },
) {
  let localStorage: StorageLike | null = null,
    indexedDB: IDBFactory | null = null;
  try {
    localStorage = window.localStorage;
  } catch {
    /* All-store read holds below. */
  }
  try {
    indexedDB = window.indexedDB ?? null;
  } catch {
    /* No unowned fallback. */
  }
  // If an exposed store is blocked, its unknown contents cannot be called empty.
  if (!localStorage || !indexedDB)
    throw new OwnedRequestRecoveryError("UNAVAILABLE");
  const candidates = (owner: Parameters<typeof ownedQueueLocation>[0]) =>
    queueStoreCandidates(ownedQueueLocation(owner), { localStorage, indexedDB })
      .candidates;
  function assertContext<
    T extends { userId: string; familyId: string; role: string },
  >(context: T): T {
    if (
      context.userId !== expected.userId ||
      context.familyId !== expected.familyId ||
      context.role !== "parent"
    )
      throw new OwnedRequestRecoveryError("OWNER_CHANGED");
    return context;
  }
  if (kind === "preparation") {
    const result = await readOwnedRequestSnapshot<
      PreparationRecoveryContext,
      PreparationRecoveryEntry,
      SavedReviewItem[]
    >({
      context: preparationRecoveryContext,
      journal: preparationRecoveryJournal,
      maxBytes: PREPARATION_JOURNAL_BYTES,
      matchesContext: preparationEntryMatchesContext,
      resolveContext: async () => assertContext(await readPreparationContext()),
      candidates,
      project: async (entries) =>
        Promise.all(
          entries.map(async (entry, index): Promise<SavedReviewItem> => {
            const command = preparationCommand.parse(JSON.parse(entry.body));
            if ((await preparationRequestHash(command)) !== entry.requestHash)
              throw new OwnedRequestRecoveryError("INTENT_CHANGED");
            const params = new URLSearchParams({
              prepareEvent: command.eventId,
              prepareZone: command.timeZone,
            });
            return {
              id: `preparation-${index}`,
              kind,
              issuedAt: command.issuedAt,
              href: `/dashboard/calendar?${params}`,
            };
          }),
        ),
    });
    return { items: result.projection, paused: !result.enabled };
  }
  const result = await readOwnedRequestSnapshot<
    ScheduleRecoveryContext,
    ScheduleRecoveryEntry,
    SavedReviewItem[]
  >({
    context: scheduleRecoveryContext,
    journal: scheduleRecoveryJournal,
    maxBytes: 256 * 1024,
    matchesContext: scheduleEntryMatchesContext,
    resolveContext: async () => assertContext(await readScheduleContext()),
    candidates,
    project: (entries) =>
      entries.map((entry, index): SavedReviewItem => {
        const command = scheduleMoveCommand.parse(JSON.parse(entry.body));
        const params = new URLSearchParams({
          reviewEvent: command.target.id,
          reviewStart: command.range.start,
          reviewEnd: command.range.end,
          reviewZone: command.timeZone,
        });
        return {
          id: `schedule-${index}`,
          kind,
          issuedAt: command.issuedAt,
          href: `/dashboard/calendar?${params}`,
        };
      }),
  });
  return { items: result.projection, paused: !result.enabled };
}
