import type { Prisma, PrismaClient } from "@prisma/client";
import {
  isProfileAgeAllowed,
  profileRoleSchema,
} from "@/lib/member-subject-contract";
import { lockHousehold } from "@/lib/household-lock";
import type { ChoreWithSubject } from "@/lib/chore-profile";
import { readChoreSubject } from "@/lib/chore-profile";

type ActionDb = Pick<PrismaClient, "$transaction">;

type ProfileTarget = {
  id: string;
  family_id: string;
  name: string;
  role: string;
  age: number | null;
  archived_at: Date | null;
  erasure_user_id: string | null;
  legacy_mapping: { user_id: string } | null;
  account_link: { user_id: string } | null;
};

const profileTargetSelect = {
  id: true,
  family_id: true,
  name: true,
  role: true,
  age: true,
  archived_at: true,
  erasure_user_id: true,
  legacy_mapping: { select: { user_id: true } },
  account_link: { select: { user_id: true } },
} as const;

function activeUnlinkedProfile(
  target: ProfileTarget | null,
  familyId: string,
  memberId: string,
): target is ProfileTarget {
  const role = target ? profileRoleSchema.safeParse(target.role) : null;
  return Boolean(
    target &&
    target.id === memberId &&
    target.family_id === familyId &&
    target.archived_at === null &&
    target.erasure_user_id === null &&
    target.legacy_mapping === null &&
    target.account_link === null &&
    role?.success &&
    isProfileAgeAllowed(role.data, target.age),
  );
}

export type ProfileCompletionResult =
  | "completed"
  | "already_completed"
  | "not_found"
  | "profile_unavailable"
  | "not_due";

/** Profile completion deliberately bypasses the User-only activity/XP path. */
export async function completeProfileChoreInTx(
  db: ActionDb,
  input: {
    choreId: string;
    familyId: string;
    memberId: string;
    deviceId: string;
    now: Date;
  },
): Promise<ProfileCompletionResult> {
  return db.$transaction(async (tx) => {
    await lockHousehold(tx, input.familyId);
    const chore = await tx.chore.findFirst({
      where: { id: input.choreId, family_id: input.familyId },
      select: {
        id: true,
        family_id: true,
        title: true,
        assigned_to: true,
        assigned_member_id: true,
        member_subject_erased: true,
        due_date: true,
        status: true,
        frequency: true,
        recurrence_id: true,
        is_template: true,
        rotation_member_ids: true,
      },
    });
    if (!chore) return "not_found";
    if (
      chore.assigned_to !== null ||
      chore.assigned_member_id !== input.memberId ||
      chore.member_subject_erased
    )
      return "profile_unavailable";
    const target = await tx.householdMember.findFirst({
      where: { id: input.memberId, family_id: input.familyId },
      select: profileTargetSelect,
    });
    if (!activeUnlinkedProfile(target, input.familyId, input.memberId))
      return "profile_unavailable";
    if (
      chore.frequency !== "once" ||
      chore.recurrence_id !== null ||
      chore.is_template ||
      chore.rotation_member_ids.length > 0
    )
      return "profile_unavailable";
    if (
      chore.due_date.toISOString().slice(0, 10) !==
      input.now.toISOString().slice(0, 10)
    )
      return "not_due";
    const updated = await tx.chore.updateMany({
      where: {
        id: input.choreId,
        family_id: input.familyId,
        assigned_member_id: input.memberId,
        status: { in: ["pending", "in_progress", "overdue"] },
      },
      data: { status: "completed", completed_at: input.now },
    });
    if (updated.count === 0) return "already_completed";
    await tx.deviceAuditEvent.create({
      data: {
        family_id: input.familyId,
        device_id: input.deviceId,
        actor_user_id: null,
        subject_member_id: input.memberId,
        subject_member_erased: false,
        type: "device.member_action",
        metadata: {
          action: "chore_complete",
          targetType: "chore",
          targetId: input.choreId,
        },
        created_at: input.now,
      },
      select: { id: true },
    });
    return "completed";
  });
}

export type ProfileUndoResult =
  | "reopened"
  | "already_open"
  | "not_found"
  | "not_allowed"
  | "verified"
  | "profile_unavailable";

export async function reopenProfileChoreInTx(
  db: ActionDb,
  input: {
    choreId: string;
    familyId: string;
    memberId: string;
    deviceId: string;
    now: Date;
    windowMs: number;
  },
): Promise<ProfileUndoResult> {
  return db.$transaction(async (tx) => {
    await lockHousehold(tx, input.familyId);
    const chore = await tx.chore.findFirst({
      where: { id: input.choreId, family_id: input.familyId },
      select: {
        id: true,
        assigned_to: true,
        assigned_member_id: true,
        member_subject_erased: true,
        status: true,
        completed_at: true,
      },
    });
    if (!chore) return "not_found";
    if (
      chore.assigned_to !== null ||
      chore.assigned_member_id !== input.memberId ||
      chore.member_subject_erased
    )
      return "profile_unavailable";
    const target = await tx.householdMember.findFirst({
      where: { id: input.memberId, family_id: input.familyId },
      select: profileTargetSelect,
    });
    if (!activeUnlinkedProfile(target, input.familyId, input.memberId))
      return "profile_unavailable";
    if (chore.status === "verified") return "verified";
    const since = new Date(input.now.getTime() - input.windowMs);
    const audit = await tx.deviceAuditEvent.findFirst({
      where: {
        family_id: input.familyId,
        device_id: input.deviceId,
        subject_member_id: input.memberId,
        type: "device.member_action",
        created_at: { gte: since },
      },
      select: { created_at: true, metadata: true },
      orderBy: { created_at: "desc" },
    });
    const metadata = audit?.metadata as {
      action?: unknown;
      targetId?: unknown;
    } | null;
    if (
      !audit ||
      metadata?.action !== "chore_complete" ||
      metadata.targetId !== input.choreId
    )
      return "not_allowed";
    if (
      chore.completed_at &&
      chore.completed_at.getTime() > audit.created_at.getTime()
    )
      return "not_allowed";
    const updated = await tx.chore.updateMany({
      where: {
        id: input.choreId,
        family_id: input.familyId,
        assigned_member_id: input.memberId,
        status: "completed",
      },
      data: { status: "pending", completed_at: null, successor_id: null },
    });
    if (updated.count === 0)
      return chore.status === "verified" ? "verified" : "already_open";
    await tx.deviceAuditEvent.create({
      data: {
        family_id: input.familyId,
        device_id: input.deviceId,
        actor_user_id: null,
        subject_member_id: input.memberId,
        subject_member_erased: false,
        type: "device.member_action",
        metadata: {
          action: "chore_undo",
          targetType: "chore",
          targetId: input.choreId,
        },
        created_at: input.now,
      },
      select: { id: true },
    });
    return "reopened";
  });
}

/** Fresh subject check used by parent verification while its lock is held. */
export function isProfileChoreSubject(
  chore: Pick<
    ChoreWithSubject,
    | "assigned_to"
    | "assigned_member_id"
    | "member_subject_erased"
    | "assignee"
    | "assigneeMember"
  >,
  familyId: string,
): boolean {
  return (
    chore.assigned_to === null &&
    chore.assigned_member_id != null &&
    readChoreSubject(chore, familyId)?.kind === "profile"
  );
}

export async function profileSubjectForVerify(
  tx: Prisma.TransactionClient,
  choreId: string,
  familyId: string,
) {
  const row = await tx.chore.findFirst({
    where: { id: choreId, family_id: familyId },
    include: {
      assignee: { select: { id: true, name: true, family_id: true } },
      assigneeMember: {
        select: {
          id: true,
          family_id: true,
          name: true,
          role: true,
          age: true,
          archived_at: true,
          erasure_user_id: true,
          legacy_mapping: { select: { user_id: true } },
          account_link: { select: { user_id: true } },
        },
      },
    },
  });
  if (!row) return null;
  const subject = readChoreSubject(row, familyId);
  return subject?.kind === "profile" ? subject : null;
}

export async function rejectProfileChoreInTx(
  tx: Prisma.TransactionClient,
  input: { choreId: string; familyId: string; notes: string | null },
): Promise<
  "reopened" | "verified" | "open" | "profile_unavailable" | "not_found"
> {
  await lockHousehold(tx, input.familyId);
  const row = await tx.chore.findFirst({
    where: { id: input.choreId, family_id: input.familyId },
    select: {
      id: true,
      status: true,
      assigned_to: true,
      assigned_member_id: true,
      member_subject_erased: true,
    },
  });
  if (!row) return "not_found";
  if (
    row.assigned_to !== null ||
    row.assigned_member_id === null ||
    row.member_subject_erased
  )
    return "profile_unavailable";
  const subject = await profileSubjectForVerify(
    tx,
    input.choreId,
    input.familyId,
  );
  if (!subject) return "profile_unavailable";
  if (row.status === "verified") return "verified";
  const updated = await tx.chore.updateMany({
    where: {
      id: input.choreId,
      family_id: input.familyId,
      assigned_member_id: subject.memberId,
      status: "completed",
    },
    data: {
      status: "pending",
      completed_at: null,
      photo_verified: false,
      verified_at: null,
      verified_notes: input.notes,
    },
  });
  if (updated.count === 0) {
    const current = await tx.chore.findUnique({
      where: { id: input.choreId },
      select: { status: true },
    });
    return current?.status === "verified" ? "verified" : "open";
  }
  return "reopened";
}
