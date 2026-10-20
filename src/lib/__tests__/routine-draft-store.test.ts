/** Authored only; storage fault/device acceptance runs in consolidated QA. */
import { createOwnedRequestJournal } from "../owned-request-journal";
import {
  routineDraftEntry,
  routineDraftJournal,
  ROUTINE_DRAFT_MAX_BYTES,
} from "../routine-draft-contract";
import { createRoutineDraftStore } from "../routine-draft-store";
import {
  routineDraftContext,
  ROUTINE_DRAFT_CONTRACT,
} from "../routine-draft-contract";
import type { RoutineEditorDraft } from "../routine-schedule-editor";
import type { QueueOwner } from "../queue-owner-contract";
import type { QueueStore } from "../offline-queue";
const owner: QueueOwner = {
  kind: "person",
  ownerId: "fixture-parent",
  generation: 0,
  scope: "d".repeat(64),
  householdScope: "b".repeat(64),
};
const context = routineDraftContext.parse({
  contract: ROUTINE_DRAFT_CONTRACT,
  enabled: true,
  owner,
  pointsEnabled: true,
  userId: owner.ownerId,
  familyId: "fixture-family",
});
const draft = (): RoutineEditorDraft => ({
  stackId: null,
  version: null,
  state: "active",
  label: "",
  anchor: "After breakfast",
  schedule: {
    frequency: "weekly",
    starts_on: null,
    weekly_days: [],
    monthly_day: null,
  },
  steps: [
    {
      client_step_id: "fixture-step",
      template_id: null,
      title: "",
      description: null,
      subject: null,
      points: 7,
      difficulty: "easy",
      icon: null,
      duration_minutes: -1,
    },
  ],
  removed: [],
});
function fixture() {
  let value: string | null = null,
    failAfterWrite = false,
    current = context;
  const memory: QueueStore = {
    read: async () => value,
    write: async (text) => {
      value = text;
      if (failAfterWrite) throw new Error("quota-after-write");
    },
    remove: async () => {
      value = null;
    },
  };
  const build = () =>
    createRoutineDraftStore({
      runtime: "fixture_draft_runtime",
      resolveContext: async () => current,
      candidates: () => [memory],
      withLease: async (_owner, run) => run(),
    });
  return {
    build,
    value: () => value,
    fail: (on: boolean) => {
      failAfterWrite = on;
    },
    disablePoints: () => {
      current = { ...context, pointsEnabled: false };
    },
    changeOwner: () => {
      current = { ...context, owner: { ...owner, scope: "f".repeat(64) } };
    },
  };
}
it("round-trips incomplete fields without applying schedule validation or inventing a subject", async () => {
  const f = fixture(),
    store = f.build();
  expect(await store.initialize()).toBeNull();
  await store.begin(draft());
  expect(await f.build().initialize()).toEqual(draft());
  expect(store.isSaved(draft())).toBe(true);
});
it("preserves another controller's changed draft until explicit adoption and never clears it as stale data", async () => {
  const f = fixture(),
    first = f.build();
  await first.initialize();
  await first.begin(draft());
  const other = f.build();
  await other.initialize();
  const changed = { ...draft(), label: "Other tab" };
  await other.write(changed);
  await expect(
    first.write({ ...draft(), label: "Old tab" }),
  ).rejects.toMatchObject({ reason: "DIVERGENT" });
  await expect(first.initialize()).rejects.toMatchObject({
    reason: "DIVERGENT",
  });
  expect(first.hasConflict()).toBe(true);
  await expect(first.clear()).rejects.toMatchObject({ reason: "DIVERGENT" });
  expect(await first.adoptStored()).toEqual(changed);
  await other.clear();
  await expect(first.initialize()).rejects.toMatchObject({
    reason: "DIVERGENT",
  });
  expect(await first.adoptStored()).toBeNull();
});
it("does not resurrect a discarded document from queued or late autosaves", async () => {
  const f = fixture(),
    store = f.build();
  await store.initialize();
  await store.begin(draft());
  const queued = store.write({ ...draft(), label: "Stale autosave" });
  const clear = store.clear();
  const results = await Promise.allSettled([queued, clear]);
  expect(results[0].status).toBe("rejected");
  expect(results[1].status).toBe("fulfilled");
  await expect(store.write(draft())).rejects.toMatchObject({
    reason: "INTENT_CHANGED",
  });
  expect(await f.build().initialize()).toBeNull();
});
it("retains uncertain proposed writes and repairs only the same known transition", async () => {
  const f = fixture(),
    store = f.build();
  await store.initialize();
  await store.begin(draft());
  f.fail(true);
  const changed = { ...draft(), label: "Latest text" };
  await expect(store.write(changed)).rejects.toMatchObject({
    reason: "UNAVAILABLE",
  });
  expect(store.hasUncertainStorage()).toBe(true);
  await expect(store.clear()).rejects.toMatchObject({ reason: "UNAVAILABLE" });
  f.fail(false);
  expect(await store.recoverStorage()).toEqual(changed);
  expect(store.isSaved(changed)).toBe(true);
  f.fail(true);
  await expect(store.clear()).rejects.toMatchObject({ reason: "UNAVAILABLE" });
  expect(store.hasUncertainStorage()).toBe(true);
  f.fail(false);
  expect(await store.recoverStorage()).toBeNull();
  expect(await f.build().initialize()).toBeNull();
});
it("holds owner changes and purges point values before returning a restored disabled-points draft", async () => {
  const f = fixture(),
    store = f.build();
  await store.initialize();
  await store.begin(draft());
  f.changeOwner();
  const original = f.value();
  await expect(
    store.write({ ...draft(), label: "Changed" }),
  ).rejects.toMatchObject({ reason: "OWNER_CHANGED" });
  expect(f.value()).toBe(original);
  const clean = fixture(),
    writer = clean.build();
  await writer.initialize();
  await writer.begin(draft());
  clean.disablePoints();
  const restored = await clean.build().initialize();
  expect(restored?.steps[0].points).toBeNull();
  const envelope = JSON.parse(clean.value()!),
    entry = JSON.parse(envelope.queue).entries[0];
  expect(JSON.parse(entry.body).draft.steps[0].points).toBeNull();
});
it("requires explicit local-only opt-in to replace drafts and never exposes them to a send callback", async () => {
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
  const build = (local: boolean) =>
    createOwnedRequestJournal({
      runtime: "fixture_journal_runtime",
      resolveContext: async () => context,
      candidates: () => [memory],
      withLease: async (_owner, run) => run(),
      contract: ROUTINE_DRAFT_CONTRACT,
      context: routineDraftContext,
      entry: routineDraftEntry,
      journal: routineDraftJournal,
      maxBytes: ROUTINE_DRAFT_MAX_BYTES,
      localDraftKind: local ? "local-routine-draft" : undefined,
      matchesContext: () => true,
    });
  const entry = routineDraftEntry.parse({
    kind: "local-routine-draft",
    key: "original_fixture_key_001",
    body: JSON.stringify({
      userId: context.userId,
      familyId: context.familyId,
      draft: draft(),
    }),
  });
  const immutable = build(false);
  await immutable.initialize();
  await immutable.stage(entry);
  await expect(
    immutable.replaceLocalDraft(entry, entry.body),
  ).rejects.toMatchObject({ reason: "INTENT_CHANGED" });
  const local = build(true);
  await local.initialize();
  const changed = {
    ...entry,
    body: JSON.stringify({
      userId: context.userId,
      familyId: context.familyId,
      draft: { ...draft(), label: "Local revision" },
    }),
  };
  await local.replaceLocalDraft(changed, entry.body);
  const send = jest.fn(async () => ({ kind: "sent" }));
  await expect(local.send(entry.key, true, send)).rejects.toMatchObject({
    reason: "DISABLED",
  });
  expect(send).not.toHaveBeenCalled();
});
