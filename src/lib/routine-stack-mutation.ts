/**
 * Current-occurrence routine stack coordinator.
 *
 * This module intentionally has no route or reader. A parent route can run it
 * inside its existing Prisma transaction after creating its IdempotencyRecord.
 * The coordinator owns the user, household, and receipt locks. The receipt is updated before this transaction commits;
 * the generic post-effect idempotency helper is deliberately not used here.
 */
import crypto from "node:crypto";
import { choreAssigneeForCreateInTx } from "@/lib/chore-member-subject";
import { lockHousehold, lockUser } from "@/lib/household-lock";
import { hashIdempotentRequest } from "@/lib/idempotency";
import { createChoreSchema } from "@/lib/validations";
import {
  fingerprintRoutineStackSnapshot,
  normalizeRoutineStackDraft,
  projectRoutineStackResponse,
  type RoutineStackMemberProjection,
  type RoutineStackSnapshotStep,
  RoutineStackValidationError,
} from "@/lib/routine-stack";

type RuntimeDelegate = {
  findFirst(args: object): Promise<unknown>;
  findMany(args: object): Promise<unknown[]>;
  create(args: object): Promise<unknown>;
  update(args: object): Promise<unknown>;
};

type RuntimeTransaction = {
  $queryRaw(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown>;
  family: RuntimeDelegate;
  routineStack: RuntimeDelegate;
  chore: RuntimeDelegate;
  idempotencyRecord: RuntimeDelegate;
};

type TransactionDatabase = {
  $transaction<T>(callback: (tx: unknown) => Promise<T>): Promise<T>;
};

export interface RoutineStackActor {
  familyId: string;
  userId: string;
  role: string;
}

export interface RoutineStackMutationOptions {
  /** IdempotencyRecord created by the route transaction; this coordinator locks it. */
  recordId?: string | null;
  /** Testable seam; production defaults to the canonical account/member check. */
  resolveAssignee?: (
    tx: unknown,
    familyId: string,
    userId: string,
  ) => Promise<{ assigned_to: string; assigned_member_id?: string } | null>;
  memberDictionary?: readonly RoutineStackMemberProjection[];
}

export interface RoutineStackMutationResult {
  status: number;
  body: unknown;
  replayed?: boolean;
}

class RoutineStackMutationError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "RoutineStackMutationError";
    this.status = status;
    this.code = code;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

function dateValue(value: unknown): Date | string {
  return value instanceof Date || typeof value === "string" ? value : "";
}

function snapshotRows(
  value: readonly Record<string, unknown>[],
): RoutineStackSnapshotStep[] {
  return value.map((row) => ({
    id: String(row.id ?? ""),
    family_id: String(row.family_id ?? ""),
    title: String(row.title ?? ""),
    description: typeof row.description === "string" ? row.description : null,
    assigned_to: String(row.assigned_to ?? ""),
    assigned_member_id:
      typeof row.assigned_member_id === "string"
        ? row.assigned_member_id
        : null,
    member_subject_erased: row.member_subject_erased === true,
    due_date: dateValue(row.due_date),
    recurrence_id:
      typeof row.recurrence_id === "string" ? row.recurrence_id : null,
    is_template: row.is_template === true,
    routine: typeof row.routine === "string" ? row.routine : null,
    routine_order:
      typeof row.routine_order === "number" ? row.routine_order : null,
    status: String(row.status ?? "pending"),
    frequency: String(row.frequency ?? "once"),
    weekly_days: Array.isArray(row.weekly_days)
      ? row.weekly_days.filter((day): day is number => typeof day === "number")
      : [],
    icon: typeof row.icon === "string" ? row.icon : null,
    points: typeof row.points === "number" ? row.points : 10,
    photo_url: typeof row.photo_url === "string" ? row.photo_url : null,
    photo_verified: row.photo_verified === true,
    verified_at:
      row.verified_at instanceof Date || typeof row.verified_at === "string"
        ? row.verified_at
        : null,
    verified_notes:
      typeof row.verified_notes === "string" ? row.verified_notes : null,
    completed_at:
      row.completed_at instanceof Date || typeof row.completed_at === "string"
        ? row.completed_at
        : null,
    created_at:
      row.created_at instanceof Date || typeof row.created_at === "string"
        ? row.created_at
        : null,
    created_by: typeof row.created_by === "string" ? row.created_by : undefined,
    successor_id:
      typeof row.successor_id === "string" ? row.successor_id : null,
    rotation_member_ids: Array.isArray(row.rotation_member_ids)
      ? row.rotation_member_ids.filter(
          (member): member is string => typeof member === "string",
        )
      : [],
    rotation_index:
      typeof row.rotation_index === "number" ? row.rotation_index : null,
    routine_stack_id:
      typeof row.routine_stack_id === "string" ? row.routine_stack_id : null,
  }));
}

function genericNotFound(): RoutineStackMutationError {
  return new RoutineStackMutationError(
    404,
    "ROUTINE_STACK_NOT_FOUND",
    "Routine stack not found.",
  );
}

function conflict(
  message = "This routine changed. Reload it and try again.",
): RoutineStackMutationError {
  return new RoutineStackMutationError(409, "ROUTINE_STACK_CONFLICT", message);
}

function invalid(message: string): RoutineStackMutationError {
  return new RoutineStackMutationError(
    400,
    "ROUTINE_STACK_INVALID_DRAFT",
    message,
  );
}

async function lockFamily(
  tx: RuntimeTransaction,
  familyId: string,
): Promise<void> {
  const result = rows(
    await tx.$queryRaw`SELECT "id" FROM "Family" WHERE "id" = ${familyId} FOR UPDATE`,
  );
  if (result.length === 0) throw genericNotFound();
}

function occurrenceBounds(date: string): { start: Date; end: Date } {
  const start = new Date(`${date}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

async function lockChore(
  tx: RuntimeTransaction,
  familyId: string,
  choreId: string,
  occurrenceDate: string,
): Promise<void> {
  const { start, end } = occurrenceBounds(occurrenceDate);
  const result = rows(
    await tx.$queryRaw`SELECT "id" FROM "Chore" WHERE "id" = ${choreId} AND "family_id" = ${familyId} AND "due_date" >= ${start} AND "due_date" < ${end} FOR UPDATE`,
  );
  if (result.length === 0) throw genericNotFound();
}

function sameDate(value: unknown, date: string): boolean {
  const actual =
    value instanceof Date
      ? value.toISOString().slice(0, 10)
      : String(value ?? "").slice(0, 10);
  return actual === date;
}

function asMutationBody(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value ?? null));
}

/**
 * Apply one occurrence draft against a transaction. The caller may create an
 * IdempotencyRecord before invoking this function and pass its ID as recordId
 * for keyed requests; the coordinator acquires the canonical user -> household
 * -> receipt locks and re-reads it before any domain detail is exposed or
 * changed.
 */
export async function mutateRoutineStackInTx<T extends object>(
  rawTx: T,
  input: unknown,
  actor: RoutineStackActor,
  options: RoutineStackMutationOptions = {},
): Promise<RoutineStackMutationResult> {
  const draft = normalizeRoutineStackDraft(input);
  if (actor.role !== "parent") {
    return {
      status: 403,
      body: {
        error: { code: "FORBIDDEN", message: "Parent access is required." },
      },
    };
  }
  if (draft.family_id !== actor.familyId) throw genericNotFound();

  const tx = rawTx as unknown as RuntimeTransaction;
  const requestHash = hashIdempotentRequest("routine-stack.mutate", draft);
  // Keep the canonical membership order even when a direct caller invokes this
  // coordinator without a route wrapper. PostgreSQL transaction advisory locks
  // are re-entrant, so a route that already holds the user lock is safe here.
  await lockUser(tx, actor.userId);
  await lockHousehold(tx, actor.familyId);
  if (options.recordId) {
    await tx.$queryRaw`SELECT "id" FROM "IdempotencyRecord" WHERE "id" = ${options.recordId} FOR UPDATE`;
    const record = asRecord(
      await tx.idempotencyRecord.findFirst({
        where: {
          id: options.recordId,
          family_id: actor.familyId,
          user_id: actor.userId,
        },
        select: {
          action: true,
          request_hash: true,
          response_status: true,
          response_body: true,
        },
      }),
    );
    if (record.action !== "routine-stack.mutate") {
      return {
        status: 422,
        body: {
          error: {
            code: "IDEMPOTENCY_KEY_REUSED",
            message: "This retry contains different routine data.",
          },
        },
      };
    }
    if (!record.request_hash) {
      return {
        status: 409,
        body: {
          error: {
            code: "IDEMPOTENCY_IN_PROGRESS",
            message: "Please retry this routine.",
            retryable: true,
          },
        },
      };
    }
    if (record.request_hash !== requestHash) {
      return {
        status: 422,
        body: {
          error: {
            code: "IDEMPOTENCY_KEY_REUSED",
            message: "This retry contains different routine data.",
          },
        },
      };
    }
    if (typeof record.response_status === "number") {
      return {
        status: record.response_status,
        body: record.response_body,
        replayed: true,
      };
    }
  }

  // Household deletion acquires this advisory lock before its Family row lock.
  // Match that order before taking the Family row lock as well.
  await lockFamily(tx, actor.familyId);
  let stack = draft.stack_id
    ? asRecord(
        await tx.routineStack.findFirst({
          where: { id: draft.stack_id, family_id: actor.familyId },
        }),
      )
    : null;
  if (draft.stack_id && !stack?.id) throw genericNotFound();

  if (stack?.id && !draft.expected_fingerprint) {
    throw invalid("Reload this routine before saving it.");
  }
  if (!stack?.id && draft.expected_fingerprint) {
    throw invalid("A new routine cannot include an existing fingerprint.");
  }

  const selectedIds = draft.steps
    .flatMap((step) => (step.chore_id ? [step.chore_id] : []))
    .concat(draft.remove_chore_ids);
  for (const id of selectedIds)
    await lockChore(tx, actor.familyId, id, draft.occurrence_date);
  const { start: occurrenceStart, end: occurrenceEnd } = occurrenceBounds(
    draft.occurrence_date,
  );
  const currentStackRows = stack?.id
    ? rows(
        await tx.chore.findMany({
          where: {
            family_id: actor.familyId,
            routine_stack_id: String(stack.id),
            due_date: { gte: occurrenceStart, lt: occurrenceEnd },
          },
          orderBy: { routine_order: "asc" },
        }),
      )
    : [];
  if (
    stack?.id &&
    fingerprintRoutineStackSnapshot(snapshotRows(currentStackRows)) !==
      draft.expected_fingerprint
  ) {
    throw conflict();
  }
  if (currentStackRows.some((row) => row.is_template === true)) {
    throw invalid(
      "Recurring chore templates must be edited outside an occurrence routine.",
    );
  }
  if (stack?.id) {
    const submittedIds = new Set(selectedIds);
    if (currentStackRows.some((row) => !submittedIds.has(String(row.id)))) {
      throw conflict(
        "Every current routine step must be kept or removed explicitly.",
      );
    }
  }
  const existingRows = rows(
    await tx.chore.findMany({
      where: {
        family_id: actor.familyId,
        id: { in: selectedIds },
        due_date: { gte: occurrenceStart, lt: occurrenceEnd },
      },
      orderBy: { routine_order: "asc" },
    }),
  );
  const existingById = new Map(
    existingRows.map((row) => [String(row.id), row]),
  );
  if (existingRows.length !== selectedIds.length) throw genericNotFound();
  if (existingRows.some((row) => row.is_template === true)) {
    throw invalid(
      "Recurring chore templates must be edited outside an occurrence routine.",
    );
  }
  for (const row of existingRows) {
    if (!sameDate(row.due_date, draft.occurrence_date))
      throw conflict("The selected step is from a different occurrence.");
    const rowId = String(row.id);
    const isRemoval = draft.remove_chore_ids.includes(rowId);
    // A removal is addressed by the locked stable chore id and the expected
    // snapshot, so it does not need to repeat the series id in the draft.
    // Retained rows must echo the locked recurrence identity so a stale or
    // cross-series payload cannot silently re-home an occurrence.
    if (!isRemoval) {
      const submittedRecurrenceId =
        draft.steps.find((step) => step.chore_id === rowId)?.recurrence_id ??
        null;
      if (submittedRecurrenceId !== (row.recurrence_id ?? null))
        throw conflict("The selected step's series identity changed.");
    }
    if (stack?.id) {
      if (row.routine_stack_id && row.routine_stack_id !== stack.id)
        throw conflict("A selected step belongs to another routine.");
      if (isRemoval && row.routine_stack_id !== stack.id)
        throw conflict("Only steps in this routine can be removed.");
    } else if (row.routine_stack_id) {
      throw conflict("A step already belongs to another routine.");
    }
  }
  if (draft.steps.length === 0)
    throw invalid("A routine needs at least one step.");

  const hadExistingStack = Boolean(stack?.id);
  let stackId = stack?.id ? String(stack.id) : crypto.randomUUID();
  if (!stack) {
    stack = asRecord(
      await tx.routineStack.create({
        data: {
          id: stackId,
          family_id: actor.familyId,
          label: draft.label,
          version: 1,
          fingerprint: "",
          created_by: actor.userId,
        },
      }),
    );
    stackId = String(stack.id ?? stackId);
  }

  const resolveAssignee =
    options.resolveAssignee ??
    ((txValue: unknown, familyId: string, userId: string) =>
      choreAssigneeForCreateInTx(txValue as never, familyId, userId));
  for (const [index, step] of draft.steps.entries()) {
    const current = step.chore_id ? existingById.get(step.chore_id) : undefined;
    const assignmentUnchanged =
      Boolean(current) &&
      current?.assigned_to === step.assigned_to &&
      (current?.assigned_member_id ?? null) ===
        (step.assigned_member_id ?? null);
    if (current?.member_subject_erased === true && !assignmentUnchanged) {
      throw invalid("An erased member subject cannot be reassigned.");
    }
    const assignee = assignmentUnchanged
      ? {
          assigned_to: String(current?.assigned_to),
          assigned_member_id:
            typeof current?.assigned_member_id === "string"
              ? current.assigned_member_id
              : undefined,
        }
      : await resolveAssignee(rawTx, actor.familyId, step.assigned_to);
    if (!assignee)
      throw invalid("Choose an active household member for every step.");
    if (
      step.assigned_member_id &&
      assignee.assigned_member_id !== step.assigned_member_id
    )
      throw invalid("The selected member account is not current.");
    const data = {
      family_id: actor.familyId,
      routine_stack_id: stackId,
      routine: draft.label,
      routine_order: index + 1,
      assigned_to: assignee.assigned_to,
      assigned_member_id: assignee.assigned_member_id ?? null,
      member_subject_erased:
        assignmentUnchanged && current?.member_subject_erased === true,
    };
    if (step.chore_id) {
      const current = existingById.get(step.chore_id);
      if (!current) throw genericNotFound();
      await tx.chore.update({ where: { id: step.chore_id }, data });
    } else {
      const canonical = createChoreSchema.safeParse({
        title: step.title,
        description: step.description ?? null,
        points: 10,
        assigned_to: assignee.assigned_to,
        due_date: step.due_date,
        difficulty: step.difficulty,
        frequency: step.frequency,
        weekly_days: step.frequency === "weekly" ? step.weekly_days : undefined,
        icon: step.icon ?? null,
        routine: draft.label,
        routine_order: index + 1,
      });
      if (!canonical.success) {
        throw invalid(
          canonical.error.issues[0]?.message ??
            "The new routine step is not valid.",
        );
      }
      await tx.chore.create({
        data: {
          ...data,
          title: step.title,
          description: step.description ?? null,
          points: 10,
          due_date: new Date(step.due_date),
          status: "pending",
          frequency: step.frequency,
          difficulty: step.difficulty,
          icon: step.icon ?? null,
          weekly_days: step.weekly_days ?? [],
          recurrence_id: step.recurrence_id ?? null,
          is_template: step.is_template,
          created_by: actor.userId,
        },
      });
    }
  }
  for (const choreId of draft.remove_chore_ids) {
    await tx.chore.update({
      where: { id: choreId },
      data: { routine_stack_id: null, routine: null, routine_order: null },
    });
  }

  const freshRows = rows(
    await tx.chore.findMany({
      where: {
        family_id: actor.familyId,
        routine_stack_id: stackId,
        due_date: { gte: occurrenceStart, lt: occurrenceEnd },
      },
      orderBy: { routine_order: "asc" },
    }),
  );
  if (freshRows.length > 99)
    throw invalid("A routine can have at most 99 steps.");
  const freshSnapshot = snapshotRows(freshRows);
  const fingerprint = fingerprintRoutineStackSnapshot(freshSnapshot);
  const version =
    hadExistingStack && typeof stack.version === "number"
      ? stack.version + 1
      : 1;
  const body = projectRoutineStackResponse({
    stack_id: stackId,
    version,
    fingerprint,
    steps: freshSnapshot,
    members: options.memberDictionary,
  });
  await tx.routineStack.update({
    where: { id: stackId },
    data: { label: draft.label, version, fingerprint },
  });
  if (options.recordId) {
    await tx.idempotencyRecord.update({
      where: { id: options.recordId },
      data: { response_status: 200, response_body: asMutationBody(body) },
    });
  }
  return { status: 200, body };
}

export async function mutateRoutineStack(
  db: TransactionDatabase,
  input: unknown,
  actor: RoutineStackActor,
  options: RoutineStackMutationOptions = {},
): Promise<RoutineStackMutationResult> {
  return db.$transaction((tx) =>
    mutateRoutineStackInTx(tx as object, input, actor, options),
  );
}

export { RoutineStackMutationError, RoutineStackValidationError };
