import type { D1ReadClient } from "./read-client";
import type { AssistantProofActor } from "@/lib/assistant-source-proof";
import { profileChoreLegacyWriteRefusal } from "@/lib/chore-profile";
import { RoutineScheduleLegacyWriteError } from "@/lib/routine-schedule-legacy";
import {
  routineOccurrencePolicy,
  type RoutineOccurrenceSnapshot,
} from "@/lib/routine-occurrence-policy";
/** Same occurrence/anchor policy as canonical person deletion. Caller witnesses
 * these reads with deletion or target review; this helper grants no authority. */
export async function readD1ChoreDeleteEligibility(
  db: D1ReadClient,
  actor: AssistantProofActor,
  id: string,
) {
  const fail = (status: number, error: string, code?: string) => ({
    status,
    body: { error, ...(code ? { code } : {}) },
  });
  const row = await db.chore.findUnique({ where: { id } });
  if (!row) return fail(404, "Chore not found");
  if (row.family_id !== actor.familyId) return fail(403, "Forbidden");
  if (row.assigned_to === null && row.assigned_member_id !== null)
    return { status: 409, body: profileChoreLegacyWriteRefusal() };
  if (actor.role !== "parent" && row.assigned_to !== actor.userId)
    return fail(403, "Only parents or the assignee can delete chores");
  if (row.routine_series_config !== null) {
    const error = new RoutineScheduleLegacyWriteError();
    return fail(409, error.message, error.code);
  }
  const root = row.recurrence_id
    ? await db.chore.findFirst({
        where: { id: row.recurrence_id, family_id: actor.familyId },
        select: { id: true, recurrence_id: true, routine_series_config: true },
      })
    : null;
  const policyRow: RoutineOccurrenceSnapshot = {
    ...row,
    own_config: row.routine_series_config,
    root_id: root?.id ?? null,
    root_recurrence_id: root?.recurrence_id ?? null,
    series_config: root?.routine_series_config ?? null,
  };
  if (
    ["inactive", "unsupported"].includes(routineOccurrencePolicy(policyRow))
  ) {
    const error = new RoutineScheduleLegacyWriteError();
    return fail(409, error.message, error.code);
  }
  if (row.recurrence_id === id) {
    if (
      row.is_template &&
      ["daily", "weekly", "monthly"].includes(row.frequency)
    )
      return fail(
        409,
        "Stop repeating before deleting the series anchor",
        "RECURRING_SERIES_REQUIRES_STOP",
      );
    if (
      await db.chore.findFirst({
        where: {
          family_id: actor.familyId,
          recurrence_id: id,
          id: { not: id },
        },
        select: { id: true },
      })
    )
      return fail(
        409,
        "Keep the series anchor to preserve its history",
        "RECURRING_ANCHOR_RETAINS_HISTORY",
      );
  }
  return null;
}
