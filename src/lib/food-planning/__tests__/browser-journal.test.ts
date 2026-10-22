/** Authored/unrun. Injected stores/leases; real browser faults are later QA. */
import { createOwnedRequestJournal } from "../../owned-request-journal";
import type { QueueStore } from "../../offline-queue";
import {
  FOOD_RECOVERY,
  foodRecoveryContext,
  foodJournalEntry,
  type FoodJournalEntry,
  foodRecoveryJournal,
  foodJournalMatchesContext,
} from "../recovery-contract";
import { context, makeEntry } from "./recovery-fixture";
function fixture(always: boolean) {
  let text: string | null = null;
  const store: QueueStore = {
    read: async () => text,
    write: async (next) => {
      text = next;
    },
    remove: async () => {
      text = null;
    },
  };
  const review = jest.fn(async () => true);
  const build = () =>
    createOwnedRequestJournal({
      runtime: "fixture_food_journal_runtime",
      contract: FOOD_RECOVERY,
      context: foodRecoveryContext,
      entry: foodJournalEntry,
      journal: foodRecoveryJournal,
      matchesContext: foodJournalMatchesContext,
      maxBytes: 768 * 1024,
      resolveContext: async () => context(),
      candidates: () => [store],
      withLease: async (_owner, run) => run(),
      reviewBeforeEverySend: always,
      reviewRecovered: review,
    });
  return { build, review, read: () => text };
}
it("requires fresh receipt/source inspection even for an in-session unknown retry", async () => {
  const f = fixture(true),
    journal = f.build(),
    entry = makeEntry();
  await journal.initialize();
  await journal.stage(entry);
  const send = jest.fn(async (_entry: FoodJournalEntry, _scope: string) => ({
    kind: "unknown",
  }));
  await journal.send(entry.key, false, send);
  expect(f.review).toHaveBeenCalledTimes(1);
  const frozen = f.read();
  f.review.mockResolvedValueOnce(false);
  await expect(journal.send(entry.key, false, send)).rejects.toMatchObject({
    reason: "REVIEW_REQUIRED",
  });
  expect(send).toHaveBeenCalledTimes(1);
  expect(f.read()).toBe(frozen);
  const restored = f.build();
  await restored.initialize();
  await expect(restored.send(entry.key, false, send)).rejects.toMatchObject({
    reason: "REVIEW_REQUIRED",
  });
  await restored.send(entry.key, true, send);
  expect(send.mock.calls[1][0]).toEqual(entry);
  expect(f.read()).toBe(frozen);
});
it("retains recovered-only behavior for existing domains that do not opt in", async () => {
  const f = fixture(false),
    journal = f.build(),
    entry = makeEntry();
  await journal.initialize();
  await journal.stage(entry);
  const send = jest.fn(async (_entry: FoodJournalEntry, _scope: string) => ({
    kind: "unknown",
  }));
  await journal.send(entry.key, false, send);
  expect(f.review).not.toHaveBeenCalled();
  expect(send).toHaveBeenCalledTimes(1);
});
