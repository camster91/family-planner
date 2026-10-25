/** Authored, not run. Dormant pure adapter; no database/account effects. */
import { prepareRoutineSubjectUnlink } from "../routine-subject-unlink";
import { routineStepSeriesConfig } from "../routine-schedule";

const association = { userId: "account-a", memberId: "profile-a" };
const definition = routineStepSeriesConfig.parse({
  protocol: "herewoven.routine-step-series.v1",
  revision: 4,
  stack_id: "stack-a",
  state: "active",
  effective_on: "2026-10-24",
  anchor: "After lunch",
  schedule: {
    frequency: "weekly",
    starts_on: "2026-10-24",
    weekly_days: [1, 3],
    monthly_day: null,
  },
  content: {
    title: "Synthetic step",
    description: null,
    subject: { kind: "account", user_id: "account-a", member_id: "profile-a" },
    points: 7,
    difficulty: "easy",
    icon: null,
    duration_minutes: 5,
  },
});
const withSubject = (subject: unknown) => ({
  ...definition,
  content: { ...definition.content, subject },
});

it.each(["active", "paused", "stopped"] as const)(
  "preserves %s future content/schedule and stable profile ID while renewing its revision",
  (state) => {
    const source = { ...definition, state };
    expect(prepareRoutineSubjectUnlink(source, association)).toEqual({
      kind: "rewrite",
      previousRevision: 4,
      stackId: "stack-a",
      value: {
        ...source,
        revision: 5,
        content: {
          ...source.content,
          subject: { kind: "profile", member_id: "profile-a" },
        },
      },
    });
    expect(source.content.subject).toEqual(definition.content.subject);
    expect(source.revision).toBe(4);
  },
);
it("invalidates reviews for a matching already-profile future definition too", () => {
  const source = withSubject({ kind: "profile", member_id: "profile-a" });
  expect(prepareRoutineSubjectUnlink(source, association)).toMatchObject({
    kind: "rewrite",
    previousRevision: 4,
    value: { revision: 5, content: { subject: source.content.subject } },
  });
});
it.each([
  { kind: "profile", member_id: "other-profile" },
  { kind: "account", user_id: "other-account", member_id: "other-profile" },
  { kind: "account", user_id: "other-account", member_id: null },
  { kind: "erased" },
])("keeps unrelated/erased subjects unchanged: %j", (subject) => {
  expect(prepareRoutineSubjectUnlink(withSubject(subject), association)).toEqual({
    kind: "unchanged",
  });
});
it("does not guess that an account-only future definition follows the profile", () => {
  expect(
    prepareRoutineSubjectUnlink(
      withSubject({ kind: "account", user_id: "account-a", member_id: null }),
      association,
    ),
  ).toEqual({ kind: "held", reason: "ambiguous-account" });
});
it.each([
  { kind: "account", user_id: "account-a", member_id: "other-profile" },
  { kind: "account", user_id: "other-account", member_id: "profile-a" },
])("holds contradicting stored associations: %j", (subject) => {
  expect(prepareRoutineSubjectUnlink(withSubject(subject), association)).toEqual({
    kind: "held",
    reason: "conflicting-association",
  });
});
it.each([
  { ...definition, protocol: "future-protocol" },
  { ...definition, content: { ...definition.content, subject: null } },
  { ...definition, future_identity: "other-account" },
  null,
])("holds unsupported metadata without normalizing or assuming it is unrelated", (source) => {
  expect(prepareRoutineSubjectUnlink(source, association)).toEqual({
    kind: "held",
    reason: "unsupported-definition",
  });
});
it("refuses revision exhaustion instead of leaving old reviewed revisions valid", () => {
  expect(
    prepareRoutineSubjectUnlink({ ...definition, revision: 2147483647 }, association),
  ).toEqual({ kind: "held", reason: "revision-exhausted" });
});
it.each([
  { userId: "", memberId: "profile-a" },
  { userId: "account-a", memberId: "" },
  { userId: "a".repeat(129), memberId: "profile-a" },
])("requires bounded exact association IDs", (target) => {
  expect(prepareRoutineSubjectUnlink(definition, target)).toEqual({
    kind: "held",
    reason: "invalid-association",
  });
});
