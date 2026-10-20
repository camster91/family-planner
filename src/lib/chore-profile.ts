import type { RoutineOccurrencePolicy } from "@/lib/routine-occurrence-policy";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { updateChoreSchema } from "@/lib/validations";
import type { EffectResult } from "@/lib/idempotency";
import { normalizedWeekdays } from "@/lib/chore-weekdays";
import {
  isProfileAgeAllowed,
  memberIdentityIdSchema,
  profileRoleSchema,
} from "@/lib/member-subject-contract";
import { lockHousehold, lockUser } from "@/lib/household-lock";
import { expandSeriesInTx } from "@/lib/recurringChores";
import {
  isProfileChoreEnabled,
  isProfileChoreRecurrenceSupported,
  PROFILE_CHORE_ENABLE_ENV,
  PROFILE_CHORE_ROLLBACK_READY_ENV,
} from "@/lib/profile-chore-gates";

export {
  isProfileChoreEnabled,
  isProfileChoreRecurrenceSupported,
  PROFILE_CHORE_ENABLE_ENV,
  PROFILE_CHORE_ROLLBACK_READY_ENV,
  PROFILE_CHORE_RECURRENCE_ENABLE_ENV,
} from "@/lib/profile-chore-gates";
export const PROFILE_CHORE_UNSUPPORTED_CODE =
  "MEMBER_PROTOCOL_UNAVAILABLE" as const;

export const profileChoreCreateSchema = z
  .object({
    protocol: z.literal(2),
    selection: z.object({ memberId: memberIdentityIdSchema }).strict(),
    title: z.string().trim().min(1).max(200),
    description: z.string().max(1000).trim().nullable().optional(),
    points: z.number().int().min(0).max(1000).default(10),
    due_date: z
      .string()
      .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid date"),
    difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
    frequency: z.enum(["once", "daily", "weekly", "monthly"]).default("once"),
    weekly_days: z.array(z.number().int().min(0).max(6)).max(7).default([]),
    photo_url: z.string().max(500).nullable().optional(),
    icon: updateChoreSchema.innerType().shape.icon,
    routine: updateChoreSchema.innerType().shape.routine,
    routine_order: updateChoreSchema.innerType().shape.routine_order,
  })
  .strict()
  .superRefine((value, context) => {
    const days = [...new Set(value.weekly_days)].sort((a, b) => a - b);
    if (value.frequency === "weekly" && days.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["weekly_days"],
        message: "Select at least one weekday for a weekly profile chore.",
      });
    }
    if (value.frequency !== "weekly" && days.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["weekly_days"],
        message: "Weekdays are only valid for weekly profile chores.",
      });
    }
  })
  .transform((value) => ({
    ...value,
    weekly_days: normalizedWeekdays(value.weekly_days),
  }));

export type ProfileChoreCreateInput = z.infer<typeof profileChoreCreateSchema>;

export type ProfileChoreErrorCode =
  | "PROFILE_CHORE_UNSUPPORTED"
  | "PROFILE_TARGET_INVALID"
  | "PROFILE_TARGET_UNAVAILABLE"
  | "PROFILE_TARGET_CONFLICT";

export class ProfileChoreError extends Error {
  constructor(public readonly code: ProfileChoreErrorCode) {
    super("The profile chore could not be applied.");
    this.name = "ProfileChoreError";
  }
}

export type ChoreSubjectDTO =
  | { kind: "account"; accountId: string; name: string }
  | {
      kind: "profile";
      memberId: string;
      name: string;
      role: "child" | "teen" | "parent";
    };

export type ProfileChoreDTO = {
  id: string;
  title: string;
  description: string | null;
  due_date: Date;
  status: string;
  frequency: string;
  weekly_days: number[];
  recurrence_id: string | null;
  is_template: boolean;
  difficulty: string;
  icon: string | null;
  routine: string | null;
  routine_order: number | null;
  subject: ChoreSubjectDTO;
  created_at: Date;
};

type SubjectRow = {
  assigned_to: string | null;
  assigned_member_id: string | null;
  member_subject_erased: boolean;
  assignee?: { id: string; name: string; family_id: string | null } | null;
  assigneeMember?: {
    id: string;
    family_id: string;
    name: string;
    role: string;
    age: number | null;
    archived_at: Date | null;
    erasure_user_id: string | null;
    legacy_mapping: { user_id: string } | null;
    account_link: { user_id: string } | null;
  } | null;
};

export const choreSubjectInclude = {
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
} as const;

export type ChoreWithSubject = Prisma.ChoreGetPayload<{
  include: typeof choreSubjectInclude;
}>;

/**
 * Convert a stored row into the only subject shape safe for a board/API DTO.
 * A profile row is never silently treated as an account row. An archived,
 * unlinked own-household profile remains displayable history only. Action
 * authority must renew active state separately; this helper never grants it.
 */
export function readChoreSubject(
  row: SubjectRow,
  familyId: string,
): ChoreSubjectDTO | null {
  if (row.member_subject_erased) return null;
  if (row.assigned_to !== null) {
    if (!row.assignee || row.assignee.family_id !== familyId) return null;
    if (row.assigned_member_id != null) {
      const member = row.assigneeMember;
      const linkedUsers = member
        ? [member.legacy_mapping?.user_id, member.account_link?.user_id].filter(
            (userId): userId is string => userId !== undefined,
          )
        : [];
      if (
        !member ||
        member.family_id !== familyId ||
        member.erasure_user_id !== null ||
        linkedUsers.length === 0 ||
        linkedUsers.some((userId) => userId !== row.assigned_to)
      )
        return null;
    }
    return {
      kind: "account",
      accountId: row.assignee.id,
      name: row.assignee.name,
    };
  }
  const member = row.assigneeMember;
  if (
    !row.assigned_member_id ||
    !member ||
    member.id !== row.assigned_member_id ||
    member.family_id !== familyId ||
    member.archived_at !== null ||
    member.erasure_user_id !== null ||
    member.legacy_mapping !== null ||
    member.account_link !== null ||
    !profileRoleSchema.safeParse(member.role).success ||
    !isProfileAgeAllowed(member.role as "child" | "teen" | "parent", member.age)
  )
    return null;
  return {
    kind: "profile",
    memberId: member.id,
    name: member.name,
    role: member.role as "child" | "teen" | "parent",
  };
}

/**
 * Capability state for actions on a readable profile-only chore.
 *
 * Recurring profile rows can outlive the private recurrence opt-in during a
 * rollback. They remain readable so the household does not lose the child's
 * name or history, but clients must not render controls that will be refused
 * by the action routes. The field is intentionally per-row: one-off profile
 * chores remain actionable while only recurring rows are paused.
 */
export type ProfileChoreActionAvailability =
  | {
      state: "active";
      requiresCompatibleClient: false;
      actions: {
        complete: true;
        undo: true;
        verify: true;
        reject: true;
      };
    }
  | {
      state: "paused";
      reason: "RECURRENCE_CAPABILITY_UNAVAILABLE";
      recovery: "refresh-and-retain-pending";
      requiresCompatibleClient: true;
      actions: {
        complete: false;
        undo: false;
        verify: false;
        reject: false;
      };
    }
  | {
      state: "paused";
      reason: "PROFILE_ARCHIVED";
      recovery: "choose-active-member";
      requiresCompatibleClient: false;
      actions: { complete: false; undo: false; verify: false; reject: false };
    };

type ProfileChoreActionRow = {
  member_subject_erased?: boolean;
  assigneeMember?: { archived_at: Date | null } | null;
  assigned_to: string | null;
  assigned_member_id: string | null;
  frequency?: string | null;
  recurrence_id?: string | null;
};

/**
 * Return the canonical action state for a profile-only row. Account rows and
 * invalid/unreadable profile rows return null so callers cannot accidentally
 * apply profile semantics to an account subject or manufacture a fallback.
 */
export function profileChoreActionAvailability(
  row: ProfileChoreActionRow,
  routinePolicy: RoutineOccurrencePolicy = "legacy",
): ProfileChoreActionAvailability | null {
  if (
    row.assigned_to !== null ||
    row.assigned_member_id === null ||
    row.member_subject_erased === true
  )
    return null;
  if (row.assigneeMember?.archived_at != null)
    return {
      state: "paused",
      reason: "PROFILE_ARCHIVED",
      recovery: "choose-active-member",
      requiresCompatibleClient: false,
      actions: { complete: false, undo: false, verify: false, reject: false },
    };

  const recurring =
    (row.recurrence_id !== null && row.recurrence_id !== undefined) ||
    (row.frequency !== undefined &&
      row.frequency !== null &&
      row.frequency !== "once");
  if (
    routinePolicy === "scheduled-once" ||
    !recurring ||
    isProfileChoreRecurrenceSupported()
  ) {
    return {
      state: "active",
      requiresCompatibleClient: false,
      actions: { complete: true, undo: true, verify: true, reject: true },
    };
  }
  return {
    state: "paused",
    reason: "RECURRENCE_CAPABILITY_UNAVAILABLE",
    recovery: "refresh-and-retain-pending",
    requiresCompatibleClient: true,
    actions: { complete: false, undo: false, verify: false, reject: false },
  };
}

type ProfileCreateDb = Pick<PrismaClient, "$transaction">;
type ProfileCreateTx = Prisma.TransactionClient;

const profileCreateInProgress = (): EffectResult => ({
  status: 409,
  body: {
    error: {
      code: "IDEMPOTENCY_IN_PROGRESS",
      message: "Please retry this profile chore.",
      retryable: true,
    },
  },
});

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

function assertProfileTarget(
  target: ProfileTarget | null,
  familyId: string,
  memberId: string,
): asserts target is ProfileTarget {
  if (!target || target.id !== memberId || target.family_id !== familyId)
    throw new ProfileChoreError("PROFILE_TARGET_UNAVAILABLE");
  const role = profileRoleSchema.safeParse(target.role);
  if (!role.success || !isProfileAgeAllowed(role.data, target.age))
    throw new ProfileChoreError("PROFILE_TARGET_CONFLICT");
  if (
    target.archived_at ||
    target.erasure_user_id ||
    target.legacy_mapping ||
    target.account_link
  ) {
    throw new ProfileChoreError("PROFILE_TARGET_CONFLICT");
  }
}

/**
 * Create the first profile-only chore under the account → household lock order.
 * The caller supplies idempotency around this transaction; this helper never
 * sends mail/notifications and never expands a series.
 */
/** Shared current profile authority for scheduled roots; never creates login identity. */
export async function profileChoreAssigneeInTx(
  tx: Prisma.TransactionClient,
  familyId: string,
  memberId: string,
) {
  await lockHousehold(tx, familyId);
  const target = await tx.householdMember.findFirst({
    where: { id: memberId, family_id: familyId },
    select: profileTargetSelect,
  });
  assertProfileTarget(target, familyId, memberId);
  return { assigned_to: null, assigned_member_id: memberId };
}

function profileChoreResponse(chore: ProfileChoreDTO): ProfileChoreDTO {
  return {
    id: chore.id,
    title: chore.title,
    description: chore.description,
    due_date: chore.due_date,
    status: chore.status,
    frequency: chore.frequency,
    weekly_days: chore.weekly_days,
    recurrence_id: chore.recurrence_id,
    is_template: chore.is_template,
    difficulty: chore.difficulty,
    icon: chore.icon ?? null,
    routine: chore.routine ?? null,
    routine_order: chore.routine_order ?? null,
    subject: chore.subject,
    created_at: chore.created_at,
  };
}

/**
 * Create the profile chore and its keyed response receipt in one transaction.
 * The receipt is locked only after the actor and household membership locks,
 * matching the account deletion order. This makes a takeover or a lost outer
 * response-store update converge on the existing response instead of creating
 * a second chore.
 */
export async function createProfileOnlyChoreInTx(
  tx: ProfileCreateTx,
  actor: { id: string; familyId: string },
  input: ProfileChoreCreateInput,
  dueDate: Date,
  photoUrl: string | null,
  recordId: string | null,
  now = new Date(),
): Promise<EffectResult> {
  // Refuse a recurring profile request before touching the idempotency receipt
  // or creating its template. A rollout can therefore turn this opt-in off
  // without replaying a cached recurring response or leaving a new series
  // half-created. One-off profile writes continue to use the existing gate.
  if (input.frequency !== "once" && !isProfileChoreRecurrenceSupported()) {
    return {
      status: 409,
      body: {
        error: PROFILE_CHORE_UNSUPPORTED_CODE,
        ...profileChoreProtocolRefusal(),
      },
    };
  }
  await lockUser(tx, actor.id);
  await lockHousehold(tx, actor.familyId);

  const currentActor = await tx.user.findUnique({
    where: { id: actor.id },
    select: { id: true, family_id: true, role: true },
  });
  if (
    !currentActor ||
    currentActor.family_id !== actor.familyId ||
    currentActor.role !== "parent"
  ) {
    throw new ProfileChoreError("PROFILE_TARGET_UNAVAILABLE");
  }

  // A takeover can overlap a slow original effect. Serialize both attempts on
  // the stable receipt after the membership locks, then re-read completion.
  if (recordId) {
    await tx.$queryRaw`SELECT "id" FROM "IdempotencyRecord" WHERE "id" = ${recordId} FOR UPDATE`;
    const receipt = await tx.idempotencyRecord.findFirst({
      where: {
        id: recordId,
        family_id: actor.familyId,
        user_id: actor.id,
      },
      select: { response_status: true, response_body: true },
    });
    if (!receipt) return profileCreateInProgress();
    if (receipt.response_status != null) {
      return { status: receipt.response_status, body: receipt.response_body };
    }
  }

  const target = await tx.householdMember.findFirst({
    where: { id: input.selection.memberId, family_id: actor.familyId },
    select: profileTargetSelect,
  });
  assertProfileTarget(target, actor.familyId, input.selection.memberId);
  const created = await tx.chore.create({
    data: {
      family_id: actor.familyId,
      title: input.title,
      description: input.description ?? null,
      points: input.points,
      assigned_to: null,
      assigned_member_id: target.id,
      member_subject_erased: false,
      due_date: dueDate,
      status: "pending",
      frequency: input.frequency,
      weekly_days: input.weekly_days,
      difficulty: input.difficulty,
      photo_url: photoUrl,
      icon: input.icon ?? null,
      routine: input.routine ?? null,
      routine_order: input.routine_order ?? null,
      created_by: actor.id,
    } as unknown as Prisma.ChoreUncheckedCreateInput,
    include: choreSubjectInclude,
  });
  const chore =
    input.frequency === "once"
      ? created
      : await tx.chore.update({
          where: { id: created.id },
          data: { recurrence_id: created.id, is_template: true },
          include: choreSubjectInclude,
        });
  if (input.frequency !== "once") {
    await expandSeriesInTx(tx, chore.id, actor.familyId, now);
  }
  const subject = readChoreSubject(chore, actor.familyId);
  if (!subject || subject.kind !== "profile")
    throw new ProfileChoreError("PROFILE_TARGET_CONFLICT");
  const dto = profileChoreResponse({
    id: chore.id,
    title: chore.title,
    description: chore.description,
    due_date: chore.due_date,
    status: chore.status,
    frequency: chore.frequency,
    weekly_days: chore.weekly_days ?? [],
    recurrence_id: chore.recurrence_id ?? null,
    is_template: chore.is_template ?? false,
    difficulty: chore.difficulty,
    icon: chore.icon ?? null,
    routine: chore.routine ?? null,
    routine_order: chore.routine_order ?? null,
    subject,
    created_at: now,
  });
  const body = { chore: dto };
  if (recordId) {
    await tx.idempotencyRecord.update({
      where: { id: recordId },
      data: {
        response_status: 200,
        response_body: JSON.parse(
          JSON.stringify(body),
        ) as Prisma.InputJsonObject,
      },
    });
  }
  return { status: 200, body };
}

export async function createProfileOnlyChoreEffect(
  db: ProfileCreateDb,
  actor: { id: string; familyId: string },
  input: ProfileChoreCreateInput,
  dueDate: Date,
  photoUrl: string | null,
  recordId: string | null,
  now = new Date(),
): Promise<EffectResult> {
  return db.$transaction((tx) =>
    createProfileOnlyChoreInTx(
      tx,
      actor,
      input,
      dueDate,
      photoUrl,
      recordId,
      now,
    ),
  );
}

/** Legacy direct helper used by non-keyed callers and existing server code. */
export async function createProfileOnlyChore(
  db: ProfileCreateDb,
  actor: { id: string; familyId: string },
  input: ProfileChoreCreateInput,
  dueDate: Date,
  photoUrl: string | null,
  now = new Date(),
) {
  const result = await createProfileOnlyChoreEffect(
    db,
    actor,
    input,
    dueDate,
    photoUrl,
    null,
    now,
  );
  return (result.body as { chore: ProfileChoreDTO }).chore;
}

export function profileChoreProtocolRefusal() {
  return {
    code: "MEMBER_PROTOCOL_UNAVAILABLE" as const,
    recovery: "refresh-and-retain-pending" as const,
    requiredProtocol: 2 as const,
    receivedProtocol: 1 as const,
  };
}

/** Legacy person routes cannot infer a User from a profile-only subject. */
export function profileChoreLegacyWriteRefusal() {
  return {
    error: PROFILE_CHORE_UNSUPPORTED_CODE,
    ...profileChoreProtocolRefusal(),
  };
}

export function requestedMemberProtocol(request: { headers: Headers }): 1 | 2 {
  return request.headers.get("X-Member-Protocol") === "2" ? 2 : 1;
}

export function profileChoreReadRefusal(request: {
  headers: Headers;
}): { status: 409; body: Record<string, unknown> } | null {
  if (isProfileChoreEnabled() && requestedMemberProtocol(request) === 2)
    return null;
  return { status: 409, body: profileChoreLegacyWriteRefusal() };
}
