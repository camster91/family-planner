import {
  responsibilityTarget,
  type ResponsibilityTarget,
} from "@/lib/responsibility-target";
export { responsibilityTarget } from "@/lib/responsibility-target";
export type { ResponsibilityTarget } from "@/lib/responsibility-target";
/** Provider-free consent metadata. Canonical target ownership is supplied by
 * a fresh authorized server read, never by a selected profile or client claim. */
import { z } from "zod";
import { memberIdentityIdSchema as id } from "@/lib/member-subject-contract";
export const RESPONSIBILITY_PROTOCOL = "herewoven.responsibility.v1" as const;
export const responsibilitySubject = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("account"), accountId: id }).strict(),
  z.object({ kind: z.literal("profile"), memberId: id }).strict(),
]);
export type ResponsibilitySubject = z.infer<typeof responsibilitySubject>;
const statement = z
  .object({
    decision: z.enum(["accepted", "declined"]),
    subject: responsibilitySubject,
    byAccountId: id,
    method: z.enum(["self", "parent-recorded"]),
    at: z.string().datetime(),
  })
  .strict()
  .refine((value) =>
    value.method === "self"
      ? value.subject.kind === "account" &&
        value.subject.accountId === value.byAccountId
      : value.subject.kind === "profile",
  );
export const responsibilityState = z
  .object({
    protocol: z.literal(RESPONSIBILITY_PROTOCOL),
    familyId: id,
    target: responsibilityTarget,
    sourceToken: z.string().regex(/^[a-f0-9]{64}$/),
    revision: z.number().int().min(0).max(2147483647),
    coordinator: z
      .object({ kind: z.literal("account"), accountId: id })
      .strict()
      .nullable(),
    primaryStatement: statement.nullable(),
    backup: z
      .object({
        subject: responsibilitySubject,
        statement: statement.nullable(),
      })
      .strict()
      .nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      (value.target.kind !== "handoff" && value.coordinator !== null) ||
      (value.target.kind !== "chore" &&
        value.backup?.subject.kind === "profile") ||
      (value.backup?.statement &&
        !sameResponsibilitySubject(
          value.backup.subject,
          value.backup.statement.subject,
        )) ||
      (value.target.kind === "handoff" &&
        value.primaryStatement &&
        !sameResponsibilitySubject(
          value.coordinator,
          value.primaryStatement.subject,
        )) ||
      (value.target.kind === "handoff" &&
        value.coordinator !== null &&
        value.backup !== null &&
        sameResponsibilitySubject(value.coordinator, value.backup.subject))
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Inconsistent responsibility state",
      });
  });
export type ResponsibilityState = z.infer<typeof responsibilityState>;
const commandScope = {
  protocol: z.literal(RESPONSIBILITY_PROTOCOL),
  userId: id,
  familyId: id,
  target: responsibilityTarget,
  sourceToken: z.string().regex(/^[a-f0-9]{64}$/),
  expectedRevision: z.number().int().min(0).max(2147483646),
  issuedAt: z.string().datetime(),
};
export const responsibilityCommand = z.discriminatedUnion("action", [
  z
    .object({
      ...commandScope,
      action: z.literal("set-backup"),
      subject: responsibilitySubject.nullable(),
    })
    .strict(),
  z
    .object({
      ...commandScope,
      action: z.literal("set-coordinator"),
      subject: z
        .object({ kind: z.literal("account"), accountId: id })
        .strict()
        .nullable(),
    })
    .strict(),
  z
    .object({
      ...commandScope,
      action: z.literal("state-intent"),
      slot: z.enum(["primary", "backup"]),
      decision: z.enum(["accepted", "declined"]),
      method: z.enum(["self", "parent-recorded"]),
    })
    .strict(),
  z
    .object({
      ...commandScope,
      action: z.literal("clear-statement"),
      slot: z.enum(["primary", "backup"]),
    })
    .strict(),
]);
export type ResponsibilityCommand = z.infer<typeof responsibilityCommand>;
export class ResponsibilityError extends Error {
  constructor(
    readonly code:
      | "NOT_FOUND"
      | "UNAUTHORIZED"
      | "FORBIDDEN"
      | "CONFLICT"
      | "UNSUPPORTED"
      | "UNAVAILABLE"
      | "SUBJECT_UNAVAILABLE"
      | "DUPLICATE_SUBJECT"
      | "NO_OWNER",
  ) {
    super(code);
  }
}
export function sameResponsibilitySubject(
  a: ResponsibilitySubject | null,
  b: ResponsibilitySubject | null,
): boolean {
  if (a === null || b === null) return a === b;
  return a.kind === "account" && b.kind === "account"
    ? a.accountId === b.accountId
    : a.kind === "profile" && b.kind === "profile" && a.memberId === b.memberId;
}
/** All properties below are server-resolved, not an API body. The persistence
 * adapter must guarantee current source epochs, family/role/profile eligibility
 * and lifecycle locks. A pure planner alone is not an authorization endpoint. */
export type ResponsibilityContext = {
  actor: { kind: "person"; userId: string; familyId: string; role: string };
  target: ResponsibilityTarget & {
    familyId: string;
    sourceToken: string;
    active: boolean;
    primary: ResponsibilitySubject | null;
  };
  eligibleSubjects: ResponsibilitySubject[];
  eligibleCoordinators: Array<{ kind: "account"; accountId: string }>;
  writesEnabled: boolean;
  /** Fresh same-household accounts allowed to appear as statement provenance. */
  statementActorIds: string[];
};
function openState(
  raw: unknown,
  context: ResponsibilityContext,
): ResponsibilityState {
  const { actor, target } = context;
  if (
    actor.kind !== "person" ||
    !["parent", "teen", "child"].includes(actor.role)
  )
    throw new ResponsibilityError("FORBIDDEN");
  if (target.kind === "handoff" && actor.role === "child")
    throw new ResponsibilityError("FORBIDDEN");
  if (target.familyId !== actor.familyId)
    throw new ResponsibilityError("NOT_FOUND");
  if (target.kind === "handoff" && target.primary !== null)
    throw new ResponsibilityError("UNSUPPORTED");
  let stored: ResponsibilityState;
  if (raw == null)
    stored = {
      protocol: RESPONSIBILITY_PROTOCOL,
      familyId: actor.familyId,
      target: { kind: target.kind, id: target.id },
      sourceToken: target.sourceToken,
      revision: 0,
      coordinator: null,
      primaryStatement: null,
      backup: null,
    };
  else {
    const parsed = responsibilityState.safeParse(raw);
    if (!parsed.success) throw new ResponsibilityError("UNSUPPORTED");
    stored = parsed.data;
    if (
      stored.familyId !== actor.familyId ||
      stored.target.kind !== target.kind ||
      stored.target.id !== target.id
    )
      throw new ResponsibilityError("NOT_FOUND");
  }
  if (
    target.kind === "chore" &&
    actor.role !== "parent" &&
    !(
      target.primary?.kind === "account" &&
      target.primary.accountId === actor.userId
    ) &&
    !(
      stored.backup?.subject.kind === "account" &&
      stored.backup.subject.accountId === actor.userId
    )
  )
    throw new ResponsibilityError("NOT_FOUND");
  return stored;
}
function primaryFor(
  state: ResponsibilityState,
  context: ResponsibilityContext,
) {
  return context.target.kind === "handoff"
    ? state.coordinator
    : context.target.primary;
}
function eligible(
  subject: ResponsibilitySubject | null,
  context: ResponsibilityContext,
) {
  return (
    subject === null ||
    context.eligibleSubjects.some((ref) =>
      sameResponsibilitySubject(ref, subject),
    )
  );
}
export function projectResponsibility(
  raw: unknown,
  context: ResponsibilityContext,
) {
  const stored = openState(raw, context),
    primary = primaryFor(stored, context);
  if (
    !eligible(primary, context) ||
    !eligible(stored.backup?.subject ?? null, context) ||
    (stored.coordinator &&
      !context.eligibleCoordinators.some((ref) =>
        sameResponsibilitySubject(ref, stored.coordinator),
      ))
  )
    throw new ResponsibilityError("SUBJECT_UNAVAILABLE");
  for (const proof of [stored.primaryStatement, stored.backup?.statement]) {
    if (proof && !context.statementActorIds.includes(proof.byAccountId))
      throw new ResponsibilityError("SUBJECT_UNAVAILABLE");
  }
  const sourceChanged = stored.sourceToken !== context.target.sourceToken;
  const primaryStatement =
    !sourceChanged &&
    stored.primaryStatement &&
    sameResponsibilitySubject(primary, stored.primaryStatement.subject)
      ? stored.primaryStatement
      : null;
  const duplicateBackup =
    stored.backup !== null &&
    sameResponsibilitySubject(primary, stored.backup.subject);
  const backup = duplicateBackup
    ? null
    : stored.backup
      ? {
          ...stored.backup,
          statement: sourceChanged ? null : stored.backup.statement,
        }
      : null;
  return {
    stored,
    primary,
    primaryStatement,
    backup,
    sourceChanged,
    duplicateBackup,
  };
}
/** Preview/effect planner only. No DB, task completion, reassignment, external
 * message, device elevation, notification or background operation lives here. */
export function planResponsibility(
  raw: unknown,
  rawCommand: unknown,
  context: ResponsibilityContext,
  now = new Date(),
) {
  const parsed = responsibilityCommand.safeParse(rawCommand);
  if (!parsed.success) throw new ResponsibilityError("UNSUPPORTED");
  const command = parsed.data,
    current = projectResponsibility(raw, context);
  if (
    command.userId !== context.actor.userId ||
    command.familyId !== context.actor.familyId
  )
    throw new ResponsibilityError("FORBIDDEN");
  if (
    command.target.kind !== context.target.kind ||
    command.target.id !== context.target.id
  )
    throw new ResponsibilityError("NOT_FOUND");
  const age = now.getTime() - Date.parse(command.issuedAt);
  if (
    !Number.isFinite(age) ||
    age > 15 * 60000 ||
    age < -60000 ||
    command.sourceToken !== context.target.sourceToken ||
    command.expectedRevision !== current.stored.revision
  )
    throw new ResponsibilityError("CONFLICT");
  if (!context.writesEnabled || !context.target.active)
    throw new ResponsibilityError("UNAVAILABLE");
  const state: ResponsibilityState = {
    ...current.stored,
    sourceToken: context.target.sourceToken,
    primaryStatement: current.primaryStatement,
    backup: current.backup,
  };
  const isParent = context.actor.role === "parent";
  if (command.action === "set-backup" || command.action === "set-coordinator") {
    if (!isParent) throw new ResponsibilityError("FORBIDDEN");
    if (!eligible(command.subject, context))
      throw new ResponsibilityError("SUBJECT_UNAVAILABLE");
    if (command.action === "set-coordinator") {
      if (context.target.kind !== "handoff")
        throw new ResponsibilityError("FORBIDDEN");
      if (
        command.subject &&
        !context.eligibleCoordinators.some((ref) =>
          sameResponsibilitySubject(ref, command.subject),
        )
      )
        throw new ResponsibilityError("SUBJECT_UNAVAILABLE");
      if (
        sameResponsibilitySubject(
          command.subject,
          state.backup?.subject ?? null,
        ) &&
        command.subject !== null
      )
        throw new ResponsibilityError("DUPLICATE_SUBJECT");
      if (!sameResponsibilitySubject(command.subject, state.coordinator))
        state.primaryStatement = null;
      state.coordinator = command.subject;
    } else {
      if (
        command.subject?.kind === "profile" &&
        context.target.kind !== "chore"
      )
        throw new ResponsibilityError("FORBIDDEN");
      if (
        command.subject !== null &&
        sameResponsibilitySubject(command.subject, current.primary)
      )
        throw new ResponsibilityError("DUPLICATE_SUBJECT");
      state.backup =
        command.subject === null
          ? null
          : sameResponsibilitySubject(
                command.subject,
                state.backup?.subject ?? null,
              )
            ? state.backup
            : { subject: command.subject, statement: null };
    }
  } else {
    const subject =
      command.slot === "primary"
        ? primaryFor(state, context)
        : (state.backup?.subject ?? null);
    if (!subject) throw new ResponsibilityError("NO_OWNER");
    const own =
      subject.kind === "account" && subject.accountId === context.actor.userId;
    if (command.action === "clear-statement") {
      if (!own && !isParent) throw new ResponsibilityError("FORBIDDEN");
      if (command.slot === "primary") state.primaryStatement = null;
      else state.backup = { ...state.backup!, statement: null };
    } else {
      if (
        command.method === "self"
          ? !own
          : !(isParent && subject.kind === "profile")
      )
        throw new ResponsibilityError("FORBIDDEN");
      const next = {
        subject,
        decision: command.decision,
        method: command.method,
        byAccountId: context.actor.userId,
        at: now.toISOString(),
      };
      if (command.slot === "primary") state.primaryStatement = next;
      else state.backup = { subject, statement: next };
    }
  }
  const changed = JSON.stringify(state) !== JSON.stringify(current.stored);
  if (changed) {
    if (state.revision >= 2147483647) throw new ResponsibilityError("CONFLICT");
    state.revision += 1;
  }
  return {
    state: responsibilityState.parse(state),
    changed,
    invalidated: {
      source: current.sourceChanged,
      duplicateBackup: current.duplicateBackup,
    },
  };
}
