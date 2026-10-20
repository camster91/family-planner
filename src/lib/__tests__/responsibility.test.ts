/** Pure source cases; no backend, database, household or rendered verification. */
import {
  RESPONSIBILITY_PROTOCOL,
  responsibilityCommand,
  responsibilityState,
  planResponsibility,
  projectResponsibility,
  type ResponsibilityContext,
  type ResponsibilityState,
} from "@/lib/responsibility";
const now = new Date("2026-10-20T16:00:00Z");
const parent = { kind: "account" as const, accountId: "parent-a" };
const teen = { kind: "account" as const, accountId: "teen-a" };
const other = { kind: "account" as const, accountId: "parent-b" };
const profile = { kind: "profile" as const, memberId: "profile-a" };
const sourceToken = "a".repeat(64);
function context(
  patch: Partial<ResponsibilityContext> = {},
): ResponsibilityContext {
  return {
    actor: {
      kind: "person",
      userId: "parent-a",
      familyId: "family-a",
      role: "parent",
    },
    target: {
      kind: "chore",
      id: "chore-a",
      familyId: "family-a",
      sourceToken,
      active: true,
      primary: parent,
    },
    eligibleSubjects: [parent, teen, other, profile],
    eligibleCoordinators: [parent, teen, other],
    statementActorIds: ["parent-a", "teen-a", "parent-b"],
    writesEnabled: true,
    ...patch,
  };
}
function command(patch: Record<string, unknown> = {}) {
  return {
    protocol: RESPONSIBILITY_PROTOCOL,
    userId: "parent-a",
    familyId: "family-a",
    target: { kind: "chore", id: "chore-a" },
    sourceToken,
    expectedRevision: 0,
    issuedAt: now.toISOString(),
    action: "state-intent",
    slot: "primary",
    decision: "accepted",
    method: "self",
    ...patch,
  };
}
const configure = (subject: unknown, revision = 0) => {
  const {
    slot: _slot,
    decision: _decision,
    method: _method,
    ...base
  } = command();
  return { ...base, action: "set-backup", subject, expectedRevision: revision };
};
it("rejects unknown protocol/fields, actor/target ambiguity and unbounded revisions", () => {
  expect(responsibilityCommand.safeParse(command()).success).toBe(true);
  for (const patch of [
    { protocol: "future" },
    { extra: "private notes" },
    { expectedRevision: -1 },
    { expectedRevision: 2147483647 },
    { userId: "" },
    { sourceToken: "old" },
  ])
    expect(responsibilityCommand.safeParse(command(patch)).success).toBe(false);
});
it("records only consent metadata and never completes/reassigns a target or profile", () => {
  const result = planResponsibility(null, command(), context(), now);
  expect(result.state.primaryStatement).toEqual({
    subject: parent,
    byAccountId: "parent-a",
    decision: "accepted",
    method: "self",
    at: now.toISOString(),
  });
  expect(result.state.revision).toBe(1);
  expect(result.state.backup).toBeNull();
  expect(Object.keys(result.state).sort()).toEqual(
    [
      "protocol",
      "familyId",
      "target",
      "sourceToken",
      "revision",
      "coordinator",
      "primaryStatement",
      "backup",
    ].sort(),
  );
  expect(responsibilityState.safeParse(result.state).success).toBe(true);
});
it("does not let a parent self-confirm or impersonate another account", () => {
  const ctx = context();
  ctx.target.primary = teen;
  for (const method of ["self", "parent-recorded"])
    expect(() =>
      planResponsibility(null, command({ method }), ctx, now),
    ).toThrow("FORBIDDEN");
});
it("keeps an explicit parent-recorded profile statement distinct from self confirmation", () => {
  const ctx = context();
  ctx.target.primary = profile;
  expect(() => planResponsibility(null, command(), ctx, now)).toThrow(
    "FORBIDDEN",
  );
  const value = planResponsibility(
    null,
    command({ method: "parent-recorded" }),
    ctx,
    now,
  );
  expect(value.state.primaryStatement).toMatchObject({
    method: "parent-recorded",
    subject: profile,
    byAccountId: "parent-a",
  });
  expect(() =>
    planResponsibility(
      null,
      command({ method: "parent-recorded" }),
      { ...ctx, eligibleSubjects: [parent] },
      now,
    ),
  ).toThrow("SUBJECT_UNAVAILABLE");
});
it("lets the named account backup explicitly accept their slot without impersonating the primary", () => {
  const ctx = context();
  const state = planResponsibility(null, configure(teen), ctx, now).state;
  expect(state.backup).toEqual({ subject: teen, statement: null });
  const teenContext = {
    ...ctx,
    actor: { ...ctx.actor, userId: "teen-a", role: "teen" },
  };
  const accepted = planResponsibility(
    state,
    command({ userId: "teen-a", expectedRevision: 1, slot: "backup" }),
    teenContext,
    now,
  ).state;
  expect(accepted.primaryStatement).toBeNull();
  expect(accepted.backup?.statement).toMatchObject({
    subject: teen,
    method: "self",
    byAccountId: "teen-a",
  });
  expect(() =>
    planResponsibility(
      state,
      { ...configure(other, 1), userId: "teen-a" },
      teenContext,
      now,
    ),
  ).toThrow("FORBIDDEN");
  expect(() =>
    planResponsibility(
      state,
      command({ userId: "teen-a", expectedRevision: 1, slot: "primary" }),
      teenContext,
      now,
    ),
  ).toThrow("FORBIDDEN");
});
it("rejects same-subject backup and preserves consent when an unchanged backup choice is saved", () => {
  const ctx = context();
  expect(() => planResponsibility(null, configure(parent), ctx, now)).toThrow(
    "DUPLICATE_SUBJECT",
  );
  const first = planResponsibility(null, configure(other), ctx, now).state;
  const same = planResponsibility(first, configure(other, 1), ctx, now);
  expect(same.changed).toBe(false);
  expect(same.state).toEqual(first);
});
it("clears changed-source statements, including away-and-back epochs, without carrying old acceptance", () => {
  const ctx = context();
  const original = planResponsibility(null, command(), ctx, now).state;
  const changed = {
    ...ctx,
    target: { ...ctx.target, sourceToken: "b".repeat(64) },
  };
  expect(projectResponsibility(original, changed).primaryStatement).toBeNull();
  expect(() =>
    planResponsibility(
      original,
      command({ expectedRevision: 1 }),
      changed,
      now,
    ),
  ).toThrow("CONFLICT");
  const rebased = planResponsibility(
    original,
    { ...configure(other, 1), sourceToken: changed.target.sourceToken },
    changed,
    now,
  );
  expect(rebased.state.primaryStatement).toBeNull();
  expect(rebased.invalidated.source).toBe(true);
  expect(rebased.state.revision).toBe(2);
});
it("reconciles a backup that became the canonical primary, preserving assignment as source of truth", () => {
  const ctx = context();
  const saved = planResponsibility(null, configure(teen), ctx, now).state;
  const next = {
    ...ctx,
    actor: { ...ctx.actor, userId: "teen-a", role: "teen" },
    target: { ...ctx.target, primary: teen, sourceToken: "b".repeat(64) },
  };
  const result = planResponsibility(
    saved,
    command({
      userId: "teen-a",
      expectedRevision: 1,
      sourceToken: next.target.sourceToken,
    }),
    next,
    now,
  );
  expect(result.state.backup).toBeNull();
  expect(result.invalidated.duplicateBackup).toBe(true);
  expect(result.state.primaryStatement?.subject).toEqual(teen);
});
it("distinguishes decline and explicit clearing from awaiting", () => {
  const ctx = context();
  const declined = planResponsibility(
    null,
    command({ decision: "declined" }),
    ctx,
    now,
  ).state;
  expect(declined.primaryStatement?.decision).toBe("declined");
  const { decision: _decision, method: _method, ...base } = command();
  const cleared = planResponsibility(
    declined,
    { ...base, action: "clear-statement", expectedRevision: 1 },
    ctx,
    now,
  ).state;
  expect(cleared.primaryStatement).toBeNull();
});
it("does not turn a sitter name into account identity; only an explicit eligible handoff coordinator owns confirmation", () => {
  const ctx = context();
  ctx.target = {
    ...ctx.target,
    kind: "handoff",
    id: "handoff-a",
    primary: null,
  };
  const target = { kind: "handoff", id: "handoff-a" };
  expect(projectResponsibility(null, ctx).primary).toBeNull();
  expect(() => planResponsibility(null, command({ target }), ctx, now)).toThrow(
    "NO_OWNER",
  );
  const state = planResponsibility(
    null,
    {
      protocol: RESPONSIBILITY_PROTOCOL,
      userId: "parent-a",
      familyId: "family-a",
      target,
      sourceToken,
      expectedRevision: 0,
      issuedAt: now.toISOString(),
      action: "set-coordinator",
      subject: parent,
    },
    ctx,
    now,
  ).state;
  expect(state.coordinator).toEqual(parent);
  expect(state.primaryStatement).toBeNull();
  expect(() =>
    projectResponsibility(state, {
      ...ctx,
      actor: { ...ctx.actor, role: "child" },
    }),
  ).toThrow("FORBIDDEN");
});
it("refuses cross-household/account/role/subject, stale/expired/paused and completed writes without replacing future metadata", () => {
  const ctx = context();
  expect(() =>
    planResponsibility(null, command({ userId: "someone-else" }), ctx, now),
  ).toThrow("FORBIDDEN");
  expect(() =>
    projectResponsibility(null, {
      ...ctx,
      actor: { ...ctx.actor, familyId: "family-b" },
    }),
  ).toThrow("NOT_FOUND");
  expect(() =>
    projectResponsibility(null, {
      ...ctx,
      actor: { ...ctx.actor, role: "profile" },
    }),
  ).toThrow("FORBIDDEN");
  expect(() =>
    planResponsibility(
      null,
      command({ issuedAt: "2026-10-20T15:00:00Z" }),
      ctx,
      now,
    ),
  ).toThrow("CONFLICT");
  expect(() =>
    planResponsibility(null, command(), { ...ctx, writesEnabled: false }, now),
  ).toThrow("UNAVAILABLE");
  expect(() =>
    planResponsibility(
      null,
      command(),
      { ...ctx, target: { ...ctx.target, active: false } },
      now,
    ),
  ).toThrow("UNAVAILABLE");
  expect(() => projectResponsibility({ protocol: "future" }, ctx)).toThrow(
    "UNSUPPORTED",
  );
  const accepted = planResponsibility(null, command(), ctx, now).state;
  expect(() =>
    projectResponsibility(accepted, { ...ctx, statementActorIds: [] }),
  ).toThrow("SUBJECT_UNAVAILABLE");
  const future: unknown = { ...accepted, protocol: "future" };
  expect(() =>
    planResponsibility(future, command({ expectedRevision: 1 }), ctx, now),
  ).toThrow("UNSUPPORTED");
  expect((future as ResponsibilityState).protocol).toBe("future");
});
