import { readFoodRecoveryContext } from "@/lib/food-planning/client";
import {
  foodRecoveryContext,
  foodRecoveryJournal,
  foodJournalMatchesContext,
  type FoodRecoveryContext,
  type FoodJournalEntry,
} from "@/lib/food-planning/recovery-contract";
import { reviewedFoodWrite } from "@/lib/food-planning/apply-contract";
import { readPrepContext } from "@/lib/meal-prep-recovery/client";
import {
  prepContext,
  prepCommand,
  type PrepContext,
} from "@/lib/meal-prep-recovery/contract";
import {
  prepJournal,
  prepJournalMatchesContext,
  type PrepJournalEntry,
} from "@/lib/meal-prep-recovery/draft-contract";
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
import { readResponsibilityContext } from "@/lib/responsibility-client";
import {
  responsibilityRecoveryContext,
  responsibilityRecoveryJournal,
  responsibilityEntryMatchesContext,
  type ResponsibilityRecoveryContext,
  type ResponsibilityRecoveryEntry,
} from "@/lib/responsibility-recovery";
import { responsibilityCommand } from "@/lib/responsibility";
import { readReviewDocumentContext } from "@/lib/review-document-browser";
import {
  reviewDocumentContext,
  reviewDocumentJournal,
  reviewDocumentPayload,
  reviewDocumentEntryMatchesContext,
  REVIEW_DOCUMENT_MAX_BYTES,
  type ReviewDocumentContext,
  type ReviewDocumentEntry,
} from "@/lib/review-document-contract";
export type SavedReviewKind =
  | "preparation"
  | "schedule"
  | "responsibility"
  | "capture"
  | "recipe"
  | "food"
  | "bulk";
export type SavedReviewItem = {
  id: string;
  kind: SavedReviewKind;
  issuedAt: string | null;
  href: string;
  phase?: "editing" | "submitted";
};
export async function readSavedReviewRequests(
  kind: SavedReviewKind,
  expected: { userId: string; familyId: string },
) {
  if (
    ![
      "preparation",
      "schedule",
      "responsibility",
      "capture",
      "recipe",
      "food",
      "bulk",
    ].includes(kind)
  )
    throw new OwnedRequestRecoveryError("UPDATE_REQUIRED");
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
  if (kind === "food") {
    const result = await readOwnedRequestSnapshot<
      FoodRecoveryContext,
      FoodJournalEntry,
      SavedReviewItem[]
    >({
      context: foodRecoveryContext,
      journal: foodRecoveryJournal,
      maxBytes: 768 * 1024,
      matchesContext: foodJournalMatchesContext,
      resolveContext: async () =>
        assertContext(await readFoodRecoveryContext()),
      candidates,
      project: (entries) =>
        entries.map((entry, index): SavedReviewItem => {
          const command =
            entry.kind === "food-plan"
              ? reviewedFoodWrite.parse(JSON.parse(entry.body))
              : null;
          return {
            id: `food-${index}`,
            kind,
            phase: entry.kind === "local-food-draft" ? "editing" : "submitted",
            issuedAt:
              command?.mode === "meals"
                ? command.meals[0].input.issued_at
                : null,
            href: "/dashboard/meals?foodPlan=recovery",
          };
        }),
    });
    return { items: result.projection, paused: !result.enabled };
  }
  if (kind === "bulk") {
    const result = await readOwnedRequestSnapshot<
      PrepContext,
      PrepJournalEntry,
      SavedReviewItem[]
    >({
      context: prepContext,
      journal: prepJournal,
      maxBytes: 768 * 1024,
      matchesContext: prepJournalMatchesContext,
      resolveContext: async () => assertContext(await readPrepContext()),
      candidates,
      project: (entries) =>
        entries.map((entry, index): SavedReviewItem => ({
          id: `bulk-${index}`,
          kind,
          phase: entry.kind === "local-prep-draft" ? "editing" : "submitted",
          issuedAt:
            entry.kind === "meal-prep"
              ? prepCommand.parse(JSON.parse(entry.body)).issuedAt
              : null,
          href: "/dashboard/meals?view=bulk&bulkWork=recovery",
        })),
    });
    return { items: result.projection, paused: !result.enabled };
  }
  if (kind === "recipe" || kind === "capture") {
    const result = await readOwnedRequestSnapshot<
      ReviewDocumentContext,
      ReviewDocumentEntry,
      SavedReviewItem[]
    >({
      context: reviewDocumentContext,
      journal: reviewDocumentJournal,
      maxBytes: REVIEW_DOCUMENT_MAX_BYTES,
      matchesContext: reviewDocumentEntryMatchesContext,
      resolveContext: async () => {
        const context = assertContext(await readReviewDocumentContext(kind));
        if (!context.adopted || context.domain !== kind)
          throw new OwnedRequestRecoveryError("DISABLED");
        return context;
      },
      candidates,
      project: (entries) =>
        entries.map((entry, index): SavedReviewItem => {
          const document = reviewDocumentPayload.parse(JSON.parse(entry.body));
          return {
            id: `${kind}-${index}`,
            kind,
            phase: document.phase,
            issuedAt: new Date(document.updatedAt).toISOString(),
            href:
              kind === "recipe"
                ? "/dashboard/meals/review"
                : "/dashboard/review?source=capture",
          };
        }),
    });
    return { items: result.projection, paused: !result.enabled };
  }
  if (kind === "responsibility") {
    const result = await readOwnedRequestSnapshot<
      ResponsibilityRecoveryContext,
      ResponsibilityRecoveryEntry,
      SavedReviewItem[]
    >({
      context: responsibilityRecoveryContext,
      journal: responsibilityRecoveryJournal,
      maxBytes: 128 * 1024,
      matchesContext: responsibilityEntryMatchesContext,
      resolveContext: async () =>
        assertContext(await readResponsibilityContext()),
      candidates,
      project: (entries) =>
        entries.map((entry, index): SavedReviewItem => {
          const command = responsibilityCommand.parse(JSON.parse(entry.body));
          const params = new URLSearchParams({
            responsibilityKind: command.target.kind,
            responsibilityId: command.target.id,
          });
          return {
            id: `responsibility-${index}`,
            kind,
            issuedAt: command.issuedAt,
            href: `/dashboard/today?${params}`,
          };
        }),
    });
    return { items: result.projection, paused: !result.enabled };
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
