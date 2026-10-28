import { getD1Database, type D1Store } from "./database";
import { normalizeFeatures, isFeatureEnabled } from "@/lib/features";
import {
  parseChoreFocusId,
  type ChoreNotificationFocus,
} from "@/lib/chore-notification-focus";
import { choreSubjectInclude, readChoreSubject } from "@/lib/chore-profile";
import { captureD1Reads } from "./read-witness";
import type { NativeD1 } from "./read-client";
import {
  routineOccurrencePolicy,
  type RoutineOccurrenceSnapshot,
} from "@/lib/routine-occurrence-policy";
export type ChoreReadOwner = {
  userId: string;
  familyId: string;
  role: string;
  generation: number;
};
export async function renewD1ChoreReadOwner(
  owner: ChoreReadOwner,
  database?: D1Store,
) {
  const row = await (database ?? (await getD1Database()))
    .withSession("first-primary")
    .prepare(
      `SELECT f.features FROM "User" u JOIN "Family" f ON f.id=u.family_id WHERE u.id=?1 AND u.family_id=?2 AND u.role=?3 AND u.token_version=?4`,
    )
    .bind(owner.userId, owner.familyId, owner.role, owner.generation)
    .first<{ features: string | null }>();
  return (
    !!row &&
    isFeatureEnabled(
      normalizeFeatures(
        row.features === null ? null : JSON.parse(row.features),
      ),
      "chores",
    )
  );
}
/** All selected permission/subject/metadata reads are witnessed together. A
 * focus is display-only; action writers still own fresh effect authority. */
export async function readD1ChoreNotificationFocus(
  owner: ChoreReadOwner,
  target: unknown,
  database?: D1Store,
): Promise<ChoreNotificationFocus | null> {
  const id = parseChoreFocusId(target);
  if (!id || !["parent", "teen", "child"].includes(owner.role)) return null;
  const store = database ?? (await getD1Database());
  const capture = await captureD1Reads(
    async (db) => {
      const actor = await db.user.findUnique({
        where: { id: owner.userId },
        select: { family_id: true, role: true, token_version: true },
      });
      if (
        !actor ||
        actor.family_id !== owner.familyId ||
        actor.role !== owner.role ||
        actor.token_version !== owner.generation
      )
        return null;
      const family = await db.family.findUnique({
        where: { id: owner.familyId },
        select: { features: true },
      });
      if (
        !family ||
        !isFeatureEnabled(normalizeFeatures(family.features), "chores")
      )
        return null;
      const row = await db.chore.findFirst({
        where: {
          id,
          family_id: owner.familyId,
          ...(owner.role === "parent" ? {} : { assigned_to: owner.userId }),
        },
        include: choreSubjectInclude,
      });
      if (!row || row.member_subject_erased) return null;
      const subject = readChoreSubject(row, owner.familyId);
      if (
        owner.role !== "parent" &&
        (subject?.kind !== "account" ||
          subject.accountId !== owner.userId ||
          row.assigneeMember?.archived_at)
      )
        return null;
      const root = row.recurrence_id
        ? await db.chore.findFirst({
            where: { id: row.recurrence_id, family_id: owner.familyId },
            select: {
              id: true,
              recurrence_id: true,
              routine_series_config: true,
            },
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
        ["pending", "in_progress", "overdue"].includes(row.status) &&
        ["inactive", "unsupported"].includes(routineOccurrencePolicy(policyRow))
      )
        return null;
      const statuses = [
          "pending",
          "in_progress",
          "completed",
          "verified",
          "approved",
          "overdue",
        ] as const,
        status = statuses.find((value) => value === row.status);
      if (!status || !Number.isFinite(row.due_date.getTime())) return null;
      return {
        id: row.id,
        title: row.title,
        description: row.description,
        dueDate: row.due_date.toISOString(),
        status,
        canComplete:
          subject?.kind === "account" &&
          !row.assigneeMember?.archived_at &&
          ["pending", "in_progress", "overdue"].includes(status),
      };
    },
    store as unknown as NativeD1,
  );
  if (!capture.value) return null;
  const session = store.withSession("first-primary");
  try {
    await session.batch(capture.checks(session));
    return capture.value;
  } catch {
    return null;
  }
}
