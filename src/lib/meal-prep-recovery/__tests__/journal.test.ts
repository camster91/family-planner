/** Authored/unrun. Injected store faults, not browser process-death acceptance. */
import { createOwnedRequestJournal } from "../../owned-request-journal";
import type { QueueStore } from "../../offline-queue";
import { PREP_RECOVERY, prepContext } from "../contract";
import {
  prepJournal,
  prepJournalEntry,
  prepJournalMatchesContext,
} from "../draft-contract";
import { makePrepDraft } from "../client";
import { context, entry } from "./fixture";
it("keeps an uncertain promotion and blocks every send until exact storage repair and inspection", async () => {
  let text: string | null = null,
    failWrite = false;
  const memory: QueueStore = {
    read: async () => text,
    write: async (value) => {
      text = value;
      if (failWrite) throw new Error("Synthetic post-write fault");
    },
    remove: async () => {
      text = null;
    },
  };
  const inspect = jest.fn(async () => true),
    send = jest.fn(async () => ({ kind: "unknown" as const }));
  const journal = createOwnedRequestJournal({
    runtime: "prep_fixture_runtime_1234",
    context: prepContext,
    entry: prepJournalEntry,
    journal: prepJournal,
    contract: PREP_RECOVERY,
    maxBytes: 768 * 1024,
    localDraftKind: "local-prep-draft",
    matchesContext: prepJournalMatchesContext,
    resolveContext: async () => context(),
    candidates: () => [memory],
    withLease: async (_owner, run) => run(),
    reviewBeforeEverySend: true,
    reviewRecovered: inspect,
  });
  await journal.initialize();
  const local = makePrepDraft(
    {
      kind: "action",
      action: "allocate",
      sessionId: "prep-a",
      batchId: "batch-a",
      requirePrepared: true,
      mealId: "",
      servings: "1",
      meals: [{ date: "2026-10-23", meal_type: "dinner", servings: "2" }],
      nextDay: "",
      expectedNext: null,
    },
    context(),
    entry().key,
  );
  await journal.stage(local);
  await expect(journal.send(local.key, false, send)).rejects.toMatchObject({
    reason: "DISABLED",
  });
  expect(send).not.toHaveBeenCalled();
  failWrite = true;
  await expect(
    journal.promoteLocalDraft(entry(), local.body),
  ).rejects.toThrow();
  expect(journal.hasUncertainStorage()).toBe(true);
  await expect(journal.send(local.key, false, send)).rejects.toThrow();
  expect(send).not.toHaveBeenCalled();
  failWrite = false;
  await journal.recoverStorage();
  expect(send).not.toHaveBeenCalled();
  await journal.send(entry().key, true, send);
  expect(inspect).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledTimes(1);
  expect((await journal.snapshot())[0]).toMatchObject(entry());
});
it("does not expose or erase original work after a role/generation owner switch", async () => {
  let current = context(),
    text: string | null = null;
  const memory: QueueStore = {
    read: async () => text,
    write: async (value) => {
      text = value;
    },
    remove: async () => {
      text = null;
    },
  };
  const journal = createOwnedRequestJournal({
    runtime: "prep_owner_runtime_1234",
    context: prepContext,
    entry: prepJournalEntry,
    journal: prepJournal,
    contract: PREP_RECOVERY,
    maxBytes: 768 * 1024,
    localDraftKind: "local-prep-draft",
    matchesContext: prepJournalMatchesContext,
    resolveContext: async () => current,
    candidates: () => [memory],
    withLease: async (_owner, run) => run(),
  });
  await journal.initialize();
  await journal.stage(entry());
  const original = text;
  current = {
    ...current,
    role: "teen",
    owner: { ...current.owner!, generation: 3, scope: "c".repeat(64) },
  };
  await expect(journal.snapshot()).rejects.toMatchObject({
    reason: "OWNER_CHANGED",
  });
  expect(text).toBe(original);
});
