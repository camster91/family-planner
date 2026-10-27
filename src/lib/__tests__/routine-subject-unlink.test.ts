/** Authored, not run. Dormant pure adapter; no database/account effects. */
import {
  prepareRoutineSubjectUnlink,
  prepareRoutineSubjectUnlinkBatch,
  ROUTINE_UNLINK_MAX_ROOTS,
} from "../routine-subject-unlink";
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

const householdAssociation = { ...association, familyId: "family-a" };
const root = (id: string, value: unknown = definition) => ({
  id,
  familyId: "family-a",
  recurrenceId: id,
  definition: value,
});
it("prepares a complete deterministic batch and deduplicates affected stack IDs", () => {
  const roots = [
    root("root-b"),
    root("root-c", withSubject({ kind: "profile", member_id: "other-profile" })),
    root("root-a"),
  ];
  const result = prepareRoutineSubjectUnlinkBatch(
    { roots, complete: true },
    householdAssociation,
  );
  expect(result).toMatchObject({
    kind: "ready",
    inspectedRoots: 3,
    unchangedRoots: 1,
    stackIds: ["stack-a"],
    rewrites: [{ rootId: "root-a" }, { rootId: "root-b" }],
  });
  expect(roots.map((row) => row.id)).toEqual(["root-b", "root-c", "root-a"]);
});
it("returns no partial changes after an otherwise rewritable root precedes an unknown definition", () => {
  const result = prepareRoutineSubjectUnlinkBatch(
    { roots: [root("root-a"), root("root-b", { protocol: "future" })], complete: true },
    householdAssociation,
  );
  expect(result).toEqual({
    kind: "held",
    reason: "future-definition-held",
    rootId: "root-b",
    detail: "unsupported-definition",
  });
  expect(result).not.toHaveProperty("rewrites");
  expect(result).not.toHaveProperty("stackIds");
});
it("holds a partial read even when its returned roots are individually supported", () => {
  expect(
    prepareRoutineSubjectUnlinkBatch(
      { roots: [root("root-a")], complete: false },
      householdAssociation,
    ),
  ).toEqual({ kind: "held", reason: "incomplete-inventory" });
});
it("never treats a bounded prefix of an oversized household as complete", () => {
  expect(
    prepareRoutineSubjectUnlinkBatch(
      {
        roots: Array.from({ length: ROUTINE_UNLINK_MAX_ROOTS + 1 }, (_, i) => root(`root-${i}`)),
        complete: true,
      },
      householdAssociation,
    ),
  ).toEqual({ kind: "held", reason: "too-many-roots" });
});
it.each([
  { ...root("root-a"), familyId: "other-family" },
  { ...root("root-a"), recurrenceId: "other-root" },
  { ...root("root-a"), id: "" },
])("holds foreign, occurrence or malformed rows before producing rewrites", (row) => {
  expect(
    prepareRoutineSubjectUnlinkBatch(
      { roots: [root("first-root"), row], complete: true },
      householdAssociation,
    ),
  ).toEqual({ kind: "held", reason: "invalid-root" });
});
it("refuses duplicate root identities instead of planning repeated revision changes", () => {
  expect(
    prepareRoutineSubjectUnlinkBatch(
      { roots: [root("root-a"), root("root-a")], complete: true },
      householdAssociation,
    ),
  ).toEqual({ kind: "held", reason: "duplicate-root" });
});
it("validates association scope even when the supplied complete inventory is empty", () => {
  expect(
    prepareRoutineSubjectUnlinkBatch(
      { roots: [], complete: true },
      { ...householdAssociation, userId: "" },
    ),
  ).toEqual({ kind: "held", reason: "invalid-scope" });
  expect(
    prepareRoutineSubjectUnlinkBatch(
      { roots: [], complete: true },
      householdAssociation,
    ),
  ).toEqual({
    kind: "ready",
    inspectedRoots: 0,
    unchangedRoots: 0,
    rewrites: [],
    stackIds: [],
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
