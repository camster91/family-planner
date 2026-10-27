/** Authored/unrun: injected journal decisions are not native/storage acceptance. */
import { createNoteRecoveryStore } from "../note-create-recovery-store";
import { noteRecoveryEntry, noteIntentFromEntry } from "../note-create-recovery-contract";
import { NOTE_CREATE_RECOVERY_CONTRACT } from "../note-create-recovery-identity";
import { makeNoteCreateIntent } from "../note-create-client";
import type { QueueStore } from "../offline-queue";
const base = { contract: NOTE_CREATE_RECOVERY_CONTRACT, enabled: true, userId: "account-a", familyId: "family-a",
  owner: { kind: "person" as const, ownerId: "account-a", scope: "a".repeat(64), householdScope: "b".repeat(64), generation: 0 } };
function setup() {
  let current = base, text: string | null = null, fail = false;
  const memory: QueueStore = { read: async () => text, write: async value => { text = value; if (fail) throw new Error("Fixture storage failure"); }, remove: async () => { text = null; } };
  const inspect = jest.fn(async () => true);
  const make = () => createNoteRecoveryStore({ runtime: "note_fixture_runtime_1234", resolveContext: async () => current,
    candidates: () => [memory], withLease: async (_owner, run) => run(), reviewRecovered: inspect });
  const intent = makeNoteCreateIntent({ title: "Fixture", body: "Private draft", color: "yellow" }, base, "note-fixture-key-0000001");
  const entry = noteRecoveryEntry.parse({ kind: "note-create", key: intent.key, body: intent.body, issuedAt: intent.issuedAt });
  return { make, entry, intent, inspect, getText: () => text, fail: (value: boolean) => { fail = value; }, setContext: (value: typeof base) => { current = value; } };
}
it("retains exact bytes across a new controller and requires explicit reviewed send", async () => {
  const fixture = setup(), first = fixture.make();
  await first.initialize(); await first.stage(fixture.entry);
  const restored = fixture.make(); const entries = await restored.initialize();
  expect(entries[0]).toMatchObject({ ...fixture.entry, reviewRequired: true });
  expect(noteIntentFromEntry(entries[0])).toEqual({ ...fixture.intent, context: { userId: base.userId, familyId: base.familyId } });
  const send = jest.fn(async () => ({ kind: "unknown" }));
  await expect(restored.send(fixture.entry.key, false, send)).rejects.toMatchObject({ reason: "REVIEW_REQUIRED" });
  expect(send).not.toHaveBeenCalled();
  await restored.send(fixture.entry.key, true, send);
  expect(fixture.inspect).toHaveBeenCalledTimes(1); expect(send).toHaveBeenCalledTimes(1);
  expect((await restored.snapshot())[0]).toMatchObject(fixture.entry);
});
it("blocks sending after an uncertain physical save until exact storage repair", async () => {
  const fixture = setup(), journal = fixture.make();
  await journal.initialize(); fixture.fail(true);
  await expect(journal.stage(fixture.entry)).rejects.toThrow();
  expect(journal.hasUncertainStorage()).toBe(true);
  const send = jest.fn();
  await expect(journal.send(fixture.entry.key, true, send)).rejects.toThrow(); expect(send).not.toHaveBeenCalled();
  fixture.fail(false); await journal.recoverStorage();
  expect((await journal.snapshot())[0]).toMatchObject(fixture.entry); expect(send).not.toHaveBeenCalled();
});
it("keeps original bytes after an owner switch or proposed different intent", async () => {
  const fixture = setup(), journal = fixture.make();
  await journal.initialize(); await journal.stage(fixture.entry);
  const original = fixture.getText();
  await expect(journal.stage({ ...fixture.entry, body: fixture.entry.body.replace("Fixture", "Changed") })).rejects.toThrow();
  expect(fixture.getText()).toBe(original);
  fixture.setContext({ ...base, owner: { ...base.owner, generation: 1, scope: "c".repeat(64) } });
  await expect(journal.snapshot()).rejects.toMatchObject({ reason: "OWNER_CHANGED" });
  expect(fixture.getText()).toBe(original);
});
it("refuses extra/legacy-unbound rows instead of adopting them", () => {
  const fixture = setup();
  expect(noteRecoveryEntry.safeParse({ ...fixture.entry, extra: true }).success).toBe(false);
  expect(noteRecoveryEntry.safeParse({ ...fixture.entry, body: JSON.stringify({ title: "Unbound", body: "", color: "yellow" }) }).success).toBe(false);
});
