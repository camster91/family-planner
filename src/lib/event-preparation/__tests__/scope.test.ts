/** Authored and unrun. These fingerprints do not prove DB authorization/locking. */
import { preparationScopeToken, type PreparationScopeMetadata } from "../scope";
import type { PreparationContext } from "../contract";
const token = "a".repeat(64);
function fixture() {
  const context: Omit<PreparationContext, "viewToken"> = {
    actor: {
      kind: "person",
      userId: "parent-a",
      familyId: "family-a",
      role: "parent",
      memberProtocol: 2,
    },
    event: {
      id: "event-a",
      familyId: "family-a",
      sourceToken: token,
      start: "2026-10-21T14:00:00Z",
      end: "2026-10-21T15:00:00Z",
      active: true,
    },
    timeZone: "America/Toronto",
    writesEnabled: true,
    pointsEnabled: false,
    profileWritesEnabled: true,
    complete: true,
    current: {
      reviewedEventSourceToken: token,
      links: [{ choreId: "chore-a", cue: null }],
    },
    eligibleSubjects: [
      { kind: "account", accountId: "parent-a" },
      { kind: "profile", memberId: "profile-a" },
    ],
    tasks: ["a", "b"].map((suffix) => ({
      id: `chore-${suffix}`,
      sourceToken: token,
      dueDay: "2026-10-20",
      subject: { kind: "account", accountId: "parent-a" },
      status: "pending",
      attachedEventId: suffix === "a" ? "event-a" : null,
      linkable: true,
      dateEditable: true,
    })),
    routine: null,
  };
  const metadata: PreparationScopeMetadata = {
    eventGeneration: "22acfa09-9174-4de0-844f-2190415054f0",
    eventEpoch: 1,
    preparationEpoch: 1,
    plan: { id: "plan-a", revision: 1 },
  };
  return { context, metadata };
}
it("normalizes unordered task and subject queries without mutating context", () => {
  const { context, metadata } = fixture();
  const original = preparationScopeToken(context, metadata);
  const reversed = {
    ...context,
    tasks: [...context.tasks].reverse(),
    eligibleSubjects: [...context.eligibleSubjects].reverse(),
  };
  expect(preparationScopeToken(reversed, metadata)).toBe(original);
  expect(context.tasks[0].id).toBe("chore-a");
});
it("invalidates source/subject policy, completion, link membership and plan lifecycle changes", () => {
  const initial = fixture();
  const original = preparationScopeToken(initial.context, initial.metadata);
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => {
      f.context.tasks[0].status = "completed";
    },
    (f: ReturnType<typeof fixture>) => {
      f.context.profileWritesEnabled = false;
    },
    (f: ReturnType<typeof fixture>) => {
      f.context.current!.links = [];
    },
    (f: ReturnType<typeof fixture>) => {
      f.context.timeZone = "UTC";
    },
    (f: ReturnType<typeof fixture>) => {
      f.metadata.preparationEpoch++;
    },
    (f: ReturnType<typeof fixture>) => {
      f.metadata.plan!.revision++;
    },
    (f: ReturnType<typeof fixture>) => {
      f.context.event.sourceToken = "b".repeat(64);
    },
  ]) {
    const f = fixture();
    mutate(f);
    expect(preparationScopeToken(f.context, f.metadata)).not.toBe(original);
  }
});
it("holds inconsistent plans, duplicate sources, foreign scope and saturated epochs", () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => {
      f.metadata.plan = null;
    },
    (f: ReturnType<typeof fixture>) => {
      f.context.tasks.push(f.context.tasks[0]);
    },
    (f: ReturnType<typeof fixture>) => {
      f.context.event.familyId = "foreign";
    },
    (f: ReturnType<typeof fixture>) => {
      f.metadata.eventEpoch = 2147483647;
    },
  ]) {
    const f = fixture();
    mutate(f);
    expect(() => preparationScopeToken(f.context, f.metadata)).toThrow();
  }
});
