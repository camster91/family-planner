/** Authored/unrun. Injected stores; actual browser/lifecycle acceptance is later. */
import { createOwnedRequestJournal } from "../../owned-request-journal";
import type { QueueStore } from "../../offline-queue";
import {
  FOOD_RECOVERY,
  foodRecoveryContext,
  foodRecoveryJournal,
  foodJournalEntry,
  foodJournalMatchesContext,
} from "../recovery-contract";
import { foodDraftEntry, newFoodDraft } from "../editor";
import { context, makeEntry } from "./recovery-fixture";
it("atomically promotes the exact editable predecessor and cannot rewrite or send a local-only draft", async () => {
  let text: string | null = null;
  const memory: QueueStore = {
    read: async () => text,
    write: async (next) => {
      text = next;
    },
    remove: async () => {
      text = null;
    },
  };
  const journal = createOwnedRequestJournal({
    runtime: "food_editor_fixture_runtime",
    context: foodRecoveryContext,
    entry: foodJournalEntry,
    journal: foodRecoveryJournal,
    contract: FOOD_RECOVERY,
    maxBytes: 768 * 1024,
    localDraftKind: "local-food-draft",
    matchesContext: foodJournalMatchesContext,
    resolveContext: async () => context(),
    candidates: () => [memory],
    withLease: async (_owner, run) => run(),
  });
  await journal.initialize();
  const local = foodDraftEntry.parse({
    kind: "local-food-draft",
    key: "food_request_123456789",
    body: JSON.stringify({
      userId: context().userId,
      familyId: context().familyId,
      draft: newFoodDraft("2026-10-22", "UTC"),
    }),
  });
  await journal.stage(local);
  const send = jest.fn(async () => ({ kind: "unknown" }));
  await expect(journal.send(local.key, true, send)).rejects.toMatchObject({
    reason: "DISABLED",
  });
  expect(send).not.toHaveBeenCalled();
  const intent = makeEntry(),
    before = text;
  await expect(
    journal.promoteLocalDraft(intent, "wrong predecessor"),
  ).rejects.toMatchObject({ reason: "INTENT_CHANGED" });
  expect(text).toBe(before);
  await journal.promoteLocalDraft(intent, local.body);
  expect((await journal.snapshot())[0]).toMatchObject(intent);
  await expect(
    journal.replaceLocalDraft(local, intent.body),
  ).rejects.toMatchObject({ reason: "INTENT_CHANGED" });
});
