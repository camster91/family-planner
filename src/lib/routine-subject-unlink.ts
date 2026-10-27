/** Dormant #557 preflight adapter. No authority, storage, occurrence or credit effects. */
import {
  routineScheduleSubject,
  routineStepSeriesConfig,
  type RoutineStepSeriesConfig,
} from "@/lib/routine-schedule";

export type RoutineSubjectUnlinkPlan =
  | { kind: "unchanged" }
  | {
      kind: "held";
      reason:
        | "invalid-association"
        | "unsupported-definition"
        | "ambiguous-account"
        | "conflicting-association"
        | "revision-exhausted";
    }
  | {
      kind: "rewrite";
      previousRevision: number;
      stackId: string | null;
      value: RoutineStepSeriesConfig;
    };

/**
 * The future unlink writer must first authorize/re-read the exact association
 * under lifecycle locks, then preflight EVERY stored future root definition in
 * that household. An unknown protocol cannot be declared unrelated by guessing
 * where it stores identity. Any held result prevents the entire unlink.
 *
 * This does not rewrite occurrence assignees, completed actors, credits or stack
 * receipts. A future writer must renew this plan and invalidate affected stack
 * reviews atomically with all supported domains before removing link/mapping.
 */
export function prepareRoutineSubjectUnlink(
  raw: unknown,
  association: { userId: string; memberId: string },
): RoutineSubjectUnlinkPlan {
  const target = routineScheduleSubject.safeParse({
    kind: "account",
    user_id: association.userId,
    member_id: association.memberId,
  });
  if (!target.success) return { kind: "held", reason: "invalid-association" };
  const parsed = routineStepSeriesConfig.safeParse(raw);
  if (!parsed.success)
    return { kind: "held", reason: "unsupported-definition" };

  const definition = parsed.data;
  const subject = definition.content.subject;
  if (subject.kind === "erased") return { kind: "unchanged" };

  if (subject.kind === "account") {
    const sameAccount = subject.user_id === association.userId;
    const sameMember = subject.member_id === association.memberId;
    if (!sameAccount && !sameMember) return { kind: "unchanged" };
    if (sameAccount && subject.member_id === null)
      return { kind: "held", reason: "ambiguous-account" };
    if (!sameAccount || !sameMember)
      return { kind: "held", reason: "conflicting-association" };
  } else if (subject.member_id !== association.memberId) {
    return { kind: "unchanged" };
  }

  // Clamping would leave the old optimistic revision valid after identity changed.
  if (definition.revision === 2147483647)
    return { kind: "held", reason: "revision-exhausted" };
  return {
    kind: "rewrite",
    previousRevision: definition.revision,
    stackId: definition.stack_id,
    value: routineStepSeriesConfig.parse({
      ...definition,
      revision: definition.revision + 1,
      content: {
        ...definition.content,
        subject: { kind: "profile", member_id: association.memberId },
      },
    }),
  };
}

/** A future locked reader uses limit + 1 and must hold, never truncate, above this cap. */
export const ROUTINE_UNLINK_MAX_ROOTS = 1000;
type RoutineUnlinkRoot = {
  id: string;
  familyId: string;
  recurrenceId: string;
  definition: unknown;
};
type RoutineUnlinkRewrite = Extract<RoutineSubjectUnlinkPlan, { kind: "rewrite" }>;
export type RoutineSubjectUnlinkBatch =
  | {
      kind: "held";
      reason:
        | "invalid-scope"
        | "incomplete-inventory"
        | "too-many-roots"
        | "invalid-root"
        | "duplicate-root";
    }
  | {
      kind: "held";
      reason: "future-definition-held";
      rootId: string;
      detail: Extract<RoutineSubjectUnlinkPlan, { kind: "held" }>["reason"];
    }
  | {
      kind: "ready";
      inspectedRoots: number;
      unchangedRoots: number;
      rewrites: Array<RoutineUnlinkRewrite & { rootId: string }>;
      stackIds: string[];
    };
const boundedId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 128;

/**
 * Internal preparation, never an HTTP command, ownership proof or write receipt.
 * The future reader supplies a complete, unfiltered household future-root inventory
 * under lifecycle locks. `complete` describes that read; it cannot authorize it.
 * The result contains NO partial rewrites when any root/definition is held.
 */
export function prepareRoutineSubjectUnlinkBatch(
  inventory: { roots: readonly RoutineUnlinkRoot[]; complete: boolean },
  association: { familyId: string; userId: string; memberId: string },
): RoutineSubjectUnlinkBatch {
  if (
    !boundedId(association.familyId) ||
    !boundedId(association.userId) ||
    !boundedId(association.memberId)
  )
    return { kind: "held", reason: "invalid-scope" };
  if (inventory.complete !== true)
    return { kind: "held", reason: "incomplete-inventory" };
  if (inventory.roots.length > ROUTINE_UNLINK_MAX_ROOTS)
    return { kind: "held", reason: "too-many-roots" };

  const ids = new Set<string>();
  for (const root of inventory.roots) {
    if (
      !boundedId(root.id) ||
      root.familyId !== association.familyId ||
      root.recurrenceId !== root.id
    )
      return { kind: "held", reason: "invalid-root" };
    if (ids.has(root.id)) return { kind: "held", reason: "duplicate-root" };
    ids.add(root.id);
  }
  const rewrites: Array<RoutineUnlinkRewrite & { rootId: string }> = [];
  const stacks = new Set<string>();
  let unchangedRoots = 0;
  // Deterministic private review order; never reorder the caller's canonical rows.
  for (const root of [...inventory.roots].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )) {
    const plan = prepareRoutineSubjectUnlink(root.definition, association);
    if (plan.kind === "held")
      return {
        kind: "held",
        reason: "future-definition-held",
        rootId: root.id,
        detail: plan.reason,
      };
    if (plan.kind === "unchanged") {
      unchangedRoots++;
      continue;
    }
    rewrites.push({ ...plan, rootId: root.id });
    if (plan.stackId) stacks.add(plan.stackId);
  }
  return {
    kind: "ready",
    inspectedRoots: inventory.roots.length,
    unchangedRoots,
    rewrites,
    stackIds: [...stacks].sort(),
  };
}
