/** Authored/unrun. In-memory fault cases are not physical/browser storage QA. */
import { createOwnedRequestJournal } from "@/lib/owned-request-journal";
import type { QueueStore } from "@/lib/offline-queue";
import {
  preparationRecoveryContext,
  preparationRecoveryEntry,
  preparationRecoveryJournal,
  preparationEntryMatchesContext,
  PREPARATION_RECOVERY,
  PREPARATION_JOURNAL_BYTES,
} from "../recovery";
import { preparationRecoveryFixture } from "./recovery-fixture";
function fixture() {
  const f = preparationRecoveryFixture();
  let stored: string | null = null,
    blocked = false,
    current = f.recovery;
  const store: QueueStore = {
    read: async () => stored,
    write: async (text) => {
      if (blocked) throw new Error("quota");
      stored = text;
    },
    remove: async () => {
      stored = null;
    },
  };
  const inspect = jest.fn(async () => true);
  const create = () =>
    createOwnedRequestJournal({
      runtime: "preparation_runtime_a",
      context: preparationRecoveryContext,
      entry: preparationRecoveryEntry,
      journal: preparationRecoveryJournal,
      contract: PREPARATION_RECOVERY,
      maxBytes: PREPARATION_JOURNAL_BYTES,
      matchesContext: preparationEntryMatchesContext,
      resolveContext: async () => current,
      candidates: () => [store],
      reviewRecovered: inspect,
      withLease: async (_owner, run) => run(),
    });
  return {
    ...f,
    create,
    inspect,
    block: () => {
      blocked = true;
    },
    pause: () => {
      current = { ...current, enabled: false };
    },
    switchOwner: () => {
      current = {
        ...current,
        owner: { ...current.owner!, scope: "f".repeat(64) },
      };
    },
  };
}
it("stages exact work before send; restored entries require explicit current review and never auto-send", async () => {
  const f = fixture(),
    send = jest.fn(async () => ({ kind: "unknown" }));
  const first = f.create();
  await first.initialize();
  await first.stage(f.entry);
  const restored = f.create();
  expect(await restored.initialize()).toEqual([
    { ...f.entry, reviewRequired: true },
  ]);
  expect(send).not.toHaveBeenCalled();
  await expect(restored.send(f.entry.key, false, send)).rejects.toMatchObject({
    reason: "REVIEW_REQUIRED",
  });
  await restored.send(f.entry.key, true, send);
  expect(f.inspect).toHaveBeenCalledWith(f.entry, f.recovery);
  expect(send).toHaveBeenCalledWith(f.entry, f.recovery.owner!.scope);
  expect(await f.create().initialize()).toEqual([
    { ...f.entry, reviewRequired: true },
  ]);
});
it("holds quota failure and owner changes before send; paused journals permit inspect/forget but no writes", async () => {
  const f = fixture(),
    send = jest.fn();
  const journal = f.create();
  await journal.initialize();
  f.block();
  await expect(journal.stage(f.entry)).rejects.toThrow();
  await expect(journal.send(f.entry.key, false, send)).rejects.toThrow();
  expect(send).not.toHaveBeenCalled();
  const owned = fixture(),
    active = owned.create();
  await active.initialize();
  await active.stage(owned.entry);
  owned.switchOwner();
  await expect(active.send(owned.entry.key, false, send)).rejects.toMatchObject(
    { reason: "OWNER_CHANGED" },
  );
  const paused = fixture(),
    saved = paused.create();
  await saved.initialize();
  await saved.stage(paused.entry);
  paused.pause();
  await saved.inspect(paused.entry.key, async () => "committed");
  await expect(saved.send(paused.entry.key, true, send)).rejects.toMatchObject({
    reason: "DISABLED",
  });
  await saved.dismiss(paused.entry.key);
  expect(send).not.toHaveBeenCalled();
});
