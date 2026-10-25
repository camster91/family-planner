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
