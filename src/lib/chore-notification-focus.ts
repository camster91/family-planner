/** Exact notification focus is a fresh role-aware read, never an action grant. */
import type { PrismaClient } from "@prisma/client";
import { MEMBER_ID_PATTERN } from "@/lib/member-identity-schema";
import { lockUser, lockHousehold } from "@/lib/household-lock";
import { normalizeFeatures, isFeatureEnabled } from "@/lib/features";
import { choreSubjectInclude, readChoreSubject } from "@/lib/chore-profile";
import { hiddenRoutineOccurrenceIds } from "@/lib/routine-occurrence-policy";
export type ChoreNotificationFocus = {
  id: string; title: string; description: string | null; dueDate: string; canComplete: boolean;
  status: "pending" | "in_progress" | "completed" | "verified" | "approved" | "overdue";
};
export function parseChoreFocusId(value: unknown): string | null {
  return typeof value === "string" && MEMBER_ID_PATTERN.test(value) ? value : null;
}
export async function readChoreNotificationFocus(
  db: Pick<PrismaClient, "$transaction">,
  owner: { userId: string; familyId: string; role: string; tokenVersion: number },
  target: unknown,
): Promise<ChoreNotificationFocus | null> {
  const id = parseChoreFocusId(target);
  if (!id || !["parent", "teen", "child"].includes(owner.role)) return null;
  return db.$transaction(async tx => {
    await lockUser(tx, owner.userId);
    await lockHousehold(tx, owner.familyId);
    const people = await tx.$queryRaw<Array<{ family_id: string | null; role: string; token_version: number }>>`
      SELECT "family_id", "role", "token_version" FROM "User" WHERE "id" = ${owner.userId} FOR SHARE`;
    const person = people[0];
    if (people.length !== 1 || person.family_id !== owner.familyId || person.role !== owner.role || person.token_version !== owner.tokenVersion) return null;
    const families = await tx.$queryRaw<Array<{ features: unknown }>>`
      SELECT "features" FROM "Family" WHERE "id" = ${owner.familyId} FOR SHARE`;
    if (families.length !== 1 || !isFeatureEnabled(normalizeFeatures(families[0].features), "chores")) return null;
    const targetRows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Chore" WHERE "id" = ${id} AND "family_id" = ${owner.familyId}
      AND (${owner.role === "parent"} OR "assigned_to" = ${owner.userId}) FOR SHARE`;
    if (targetRows.length !== 1) return null;
    const row = await tx.chore.findFirst({
      where: { id, family_id: owner.familyId, ...(owner.role === "parent" ? {} : { assigned_to: owner.userId }) },
      select: {
        id: true, title: true, description: true, due_date: true, status: true,
        assigned_to: true, assigned_member_id: true, member_subject_erased: true,
        ...choreSubjectInclude,
      },
    });
    if (!row || row.member_subject_erased) return null;
    const subject = readChoreSubject(row, owner.familyId);
    if (owner.role !== "parent" && (subject?.kind !== "account" || subject.accountId !== owner.userId || row.assigneeMember?.archived_at)) return null;
    if ((await hiddenRoutineOccurrenceIds(tx, owner.familyId, { ids: [id] })).includes(id)) return null;
    const statuses = ["pending", "in_progress", "completed", "verified", "approved", "overdue"] as const;
    const status = statuses.find(value => value === row.status);
    if (!status || !Number.isFinite(row.due_date.getTime())) return null;
    return { id: row.id, title: row.title, description: row.description, dueDate: row.due_date.toISOString(), status,
      canComplete: subject?.kind === "account" && !row.assigneeMember?.archived_at && ["pending", "in_progress", "overdue"].includes(status),
    };
  }, { timeout: 5000, maxWait: 5000 });
}
