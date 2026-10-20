/** Authored only; consolidated QA remains deferred. */
import { createIndependentDraftStore } from "../routine-independent-draft-store";
import {
  independentEditorDraftSchema,
  independentDraftContext,
  INDEPENDENT_DRAFT_CONTRACT,
  independentDraftCommand,
  independentDraftMatchesCommand,
} from "../routine-independent-draft-contract";
import type { QueueStore } from "../offline-queue";
const draft = independentEditorDraftSchema.parse({
  rootId: "root-a",
  revision: 2,
  state: "active",
  anchor: "",
  schedule: {
    frequency: "weekly",
    starts_on: null,
    weekly_days: [],
    monthly_day: null,
  },
  content: {
    title: "",
    description: null,
    subject: null,
    points: 23,
    difficulty: "easy",
    icon: null,
    duration_minutes: -1,
  },
});
function fixture() {
  let value: string | null = null;
  let context = independentDraftContext.parse({
    contract: INDEPENDENT_DRAFT_CONTRACT,
    userId: "parent",
    familyId: "family",
    enabled: true,
    pointsEnabled: true,
    owner: {
      kind: "person",
      ownerId: "parent",
      scope: "a".repeat(64),
      householdScope: "b".repeat(64),
      generation: 0,
    },
  });
  const memory: QueueStore = {
    read: async () => value,
    write: async (next) => {
      value = next;
    },
    remove: async () => {
      value = null;
    },
  };
  return {
    build: () =>
      createIndependentDraftStore({
        runtime: "independent_draft_fixture",
        resolveContext: async () => context,
        candidates: () => [memory],
        withLease: async (_owner, run) => run(),
      }),
    value: () => value,
    hidePoints: () => {
      context = { ...context, pointsEnabled: false };
    },
  };
}
it("retains incomplete independent fields separately from strict send intent and purges disabled points", async () => {
  const f = fixture(),
    store = f.build();
  await store.initialize();
  await store.begin(draft);
  expect(await f.build().initialize()).toEqual(draft);
  expect(() =>
    independentDraftCommand(
      draft,
      { userId: "parent", familyId: "family" },
      new Date("2026-10-20T16:00:00Z"),
      "America/Toronto",
      "2026-10-20",
    ),
  ).toThrow();
  f.hidePoints();
  expect(await f.build().initialize()).toMatchObject({
    rootId: "root-a",
    revision: 2,
    content: { title: "", subject: null, points: null, duration_minutes: -1 },
  });
});
it("requires explicit adoption after competing edits and invalidates autosaves after discard", async () => {
  const f = fixture(),
    first = f.build();
  await first.initialize();
  await first.begin(draft);
  const other = f.build();
  await other.initialize();
  const changed = { ...draft, anchor: "Other tab cue" };
  await other.write(changed);
  await expect(first.initialize()).rejects.toMatchObject({
    reason: "DIVERGENT",
  });
  await expect(first.clear()).rejects.toMatchObject({ reason: "DIVERGENT" });
  expect(await first.adoptStored()).toEqual(changed);
  await first.clear();
  await expect(first.write(changed)).rejects.toMatchObject({
    reason: "INTENT_CHANGED",
  });
  expect(await f.build().initialize()).toBeNull();
});
it("matches only the exact originating draft before clearing a confirmed save", () => {
  const valid = {
    ...draft,
    schedule: { ...draft.schedule, weekly_days: [1, 3] },
    content: {
      ...draft.content,
      title: "Fixture step",
      subject: { kind: "profile" as const, member_id: "profile" },
      duration_minutes: 5,
    },
  };
  const command = independentDraftCommand(
    valid,
    { userId: "parent", familyId: "family" },
    new Date("2026-10-20T16:00:00Z"),
    "America/Toronto",
    "2026-10-20",
  );
  expect(independentDraftMatchesCommand(valid, command)).toBe(true);
  expect(
    independentDraftMatchesCommand({ ...valid, rootId: "other-root" }, command),
  ).toBe(false);
  expect(
    independentDraftMatchesCommand({ ...valid, revision: 3 }, command),
  ).toBe(false);
  expect(
    independentDraftMatchesCommand(
      { ...valid, content: { ...valid.content, title: "Unsent newer title" } },
      command,
    ),
  ).toBe(false);
  expect(
    independentDraftMatchesCommand(valid, { ...command, action: "stop" }),
  ).toBe(false);
});
