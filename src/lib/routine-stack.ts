import crypto from "node:crypto";
import { z } from "zod";
import {
  normalizeRoutineName,
  ROUTINE_NAME_MAX,
  ROUTINE_ORDER_MAX,
} from "@/lib/routine-icons";

/** The first core slice edits one dated occurrence only. */
export const ROUTINE_STACK_SCOPE = "occurrence" as const;
export const ROUTINE_STACK_MAX_STEPS = ROUTINE_ORDER_MAX;
export const ROUTINE_STACK_RESPONSE_MAX_BYTES = 8 * 1024;

export type RoutineStackScope = typeof ROUTINE_STACK_SCOPE | "future-series";

export class RoutineStackValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RoutineStackValidationError";
    this.code = code;
  }
}

const frequencySchema = z.enum(["once", "daily", "weekly", "monthly"]);
const draftStepSchema = z
  .object({
    chore_id: z.string().trim().min(1).max(128).optional(),
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    assigned_to: z.string().trim().min(1).max(128),
    assigned_member_id: z.string().trim().min(1).max(128).nullable().optional(),
    due_date: z.string().trim().min(1).max(64),
    frequency: frequencySchema,
    weekly_days: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
    icon: z.string().trim().max(80).nullable().optional(),
    routine: z.string().trim().max(200).nullable().optional(),
    routine_order: z
      .number()
      .int()
      .min(1)
      .max(ROUTINE_ORDER_MAX)
      .nullable()
      .optional(),
    recurrence_id: z.string().trim().min(1).max(128).nullable().optional(),
    is_template: z.boolean().default(false),
  })
  .strict();

const draftSchema = z
  .object({
    scope: z.enum(["occurrence", "future-series"]).default("occurrence"),
    family_id: z.string().trim().min(1).max(128),
    stack_id: z.string().trim().min(1).max(128).nullable().optional(),
    occurrence_date: z.string().trim().min(1).max(64),
    label: z.string().trim().min(1).max(200),
    steps: z.array(draftStepSchema).max(ROUTINE_STACK_MAX_STEPS),
    remove_chore_ids: z
      .array(z.string().trim().min(1).max(128))
      .max(ROUTINE_STACK_MAX_STEPS)
      .default([]),
    expected_fingerprint: z.string().trim().max(128),
  })
  .strict();

export type RoutineStackDraftStep = z.infer<typeof draftStepSchema>;
export type RoutineStackDraft = Omit<
  z.infer<typeof draftSchema>,
  "scope" | "label" | "occurrence_date"
> & {
  scope: typeof ROUTINE_STACK_SCOPE;
  label: string;
  occurrence_date: string;
};

function validDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

function normalizedWeekdays(value: readonly number[] | undefined): number[] {
  return [...new Set(value ?? [])].sort((a, b) => a - b);
}

/**
 * Validate and normalize the complete editor draft before opening a write
 * transaction. This intentionally accepts only the current-occurrence scope;
 * future-series editing needs its own reviewed series policy.
 */
export function normalizeRoutineStackDraft(input: unknown): RoutineStackDraft {
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) {
    throw new RoutineStackValidationError(
      "ROUTINE_STACK_INVALID_DRAFT",
      parsed.error.issues[0]?.message ?? "Invalid routine stack draft",
    );
  }
  if (parsed.data.scope !== ROUTINE_STACK_SCOPE) {
    throw new RoutineStackValidationError(
      "ROUTINE_STACK_FUTURE_UNSUPPORTED",
      "Future-series routine editing is not available yet.",
    );
  }
  if (!validDateOnly(parsed.data.occurrence_date)) {
    throw new RoutineStackValidationError(
      "ROUTINE_STACK_INVALID_DATE",
      "Choose a valid occurrence date.",
    );
  }
  const label = normalizeRoutineName(parsed.data.label);
  if (!label || label.length > ROUTINE_NAME_MAX) {
    throw new RoutineStackValidationError(
      "ROUTINE_STACK_INVALID_LABEL",
      `Routine name must be ${ROUTINE_NAME_MAX} characters or fewer.`,
    );
  }

  const seen = new Set<string>();
  for (const step of parsed.data.steps) {
    if (step.is_template) {
      throw new RoutineStackValidationError(
        "ROUTINE_STACK_RECURRENCE_UNSUPPORTED",
        "Routine stacks can edit one occurrence at a time; recurring templates are not supported yet.",
      );
    }
    // A generated occurrence may carry its canonical series id, but a new
    // current-occurrence step cannot invent a recurring series. Future-series
    // creation remains an explicit, separately reviewed scope.
    if (!step.chore_id && (step.recurrence_id || step.frequency !== "once")) {
      throw new RoutineStackValidationError(
        "ROUTINE_STACK_RECURRENCE_UNSUPPORTED",
        "New routine steps must be one-time occurrences; recurring steps need a separate series edit.",
      );
    }
    if (step.chore_id && seen.has(step.chore_id)) {
      throw new RoutineStackValidationError(
        "ROUTINE_STACK_DUPLICATE_STEP",
        "A routine step was selected more than once.",
      );
    }
    if (step.chore_id) seen.add(step.chore_id);
    if (!step.chore_id && !step.title) {
      throw new RoutineStackValidationError(
        "ROUTINE_STACK_STEP_TITLE_REQUIRED",
        "A new routine step needs a title.",
      );
    }
    if (!validDateOnly(step.due_date.slice(0, 10))) {
      throw new RoutineStackValidationError(
        "ROUTINE_STACK_INVALID_STEP_DATE",
        "A routine step has an invalid date.",
      );
    }
    if (
      !step.chore_id &&
      step.due_date.slice(0, 10) !== parsed.data.occurrence_date
    ) {
      throw new RoutineStackValidationError(
        "ROUTINE_STACK_STEP_DATE_SCOPE",
        "New routine steps must use the selected occurrence date.",
      );
    }
    const weekdays = normalizedWeekdays(step.weekly_days);
    if (weekdays.length !== (step.weekly_days ?? []).length) {
      throw new RoutineStackValidationError(
        "ROUTINE_STACK_DUPLICATE_WEEKDAY",
        "Choose each weekday only once.",
      );
    }
    if (step.frequency === "weekly" && weekdays.length === 0) {
      throw new RoutineStackValidationError(
        "ROUTINE_STACK_WEEKDAY_REQUIRED",
        "A weekly routine needs at least one weekday.",
      );
    }
    if (step.frequency !== "weekly" && weekdays.length > 0) {
      throw new RoutineStackValidationError(
        "ROUTINE_STACK_WEEKDAY_FREQUENCY",
        "Weekdays require a weekly routine.",
      );
    }
    step.weekly_days = weekdays;
    step.routine = normalizeRoutineName(step.routine);
  }
  const removed = new Set<string>();
  for (const id of parsed.data.remove_chore_ids) {
    if (removed.has(id) || seen.has(id)) {
      throw new RoutineStackValidationError(
        "ROUTINE_STACK_DUPLICATE_REMOVE",
        "A routine step cannot be selected and removed together.",
      );
    }
    removed.add(id);
  }

  return {
    ...parsed.data,
    scope: ROUTINE_STACK_SCOPE,
    label,
    occurrence_date: parsed.data.occurrence_date,
    steps: parsed.data.steps.map((step) => ({
      ...step,
      routine: normalizeRoutineName(step.routine),
    })),
    remove_chore_ids: [...parsed.data.remove_chore_ids],
  };
}

export interface RoutineStackSnapshotStep {
  id: string;
  family_id: string;
  title: string;
  description?: string | null;
  assigned_to: string;
  assigned_member_id?: string | null;
  member_subject_erased?: boolean;
  due_date: Date | string;
  recurrence_id?: string | null;
  is_template?: boolean;
  routine?: string | null;
  routine_order?: number | null;
  status: string;
  frequency: string;
  weekly_days?: readonly number[];
  icon?: string | null;
  points?: number;
  photo_url?: string | null;
  photo_verified?: boolean;
  verified_at?: Date | string | null;
  verified_notes?: string | null;
  completed_at?: Date | string | null;
  created_at?: Date | string | null;
  created_by?: string;
  successor_id?: string | null;
  rotation_member_ids?: readonly string[];
  rotation_index?: number | null;
  routine_stack_id?: string | null;
}

function canonicalValue(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value === null || typeof value !== "object")
    return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalValue(item)}`)
    .join(",")}}`;
}

/** Fields that can change the selected occurrence and therefore its conflict token. */
export function routineStackFingerprintInput(
  steps: readonly RoutineStackSnapshotStep[],
): unknown[] {
  return [...steps]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((step) => ({
      id: step.id,
      family_id: step.family_id,
      title: step.title,
      description: step.description ?? null,
      assigned_to: step.assigned_to,
      assigned_member_id: step.assigned_member_id ?? null,
      member_subject_erased: step.member_subject_erased === true,
      due_date: step.due_date,
      recurrence_id: step.recurrence_id ?? null,
      is_template: step.is_template === true,
      routine: normalizeRoutineName(step.routine),
      routine_order: step.routine_order ?? null,
      status: step.status,
      frequency: step.frequency,
      weekly_days: normalizedWeekdays(step.weekly_days),
      icon: step.icon ?? null,
      points: step.points ?? 10,
      photo_url: step.photo_url ?? null,
      photo_verified: step.photo_verified === true,
      verified_at: step.verified_at ?? null,
      verified_notes: step.verified_notes ?? null,
      completed_at: step.completed_at ?? null,
      created_at: step.created_at ?? null,
      created_by: step.created_by ?? null,
      successor_id: step.successor_id ?? null,
      rotation_member_ids: [...(step.rotation_member_ids ?? [])],
      rotation_index: step.rotation_index ?? null,
      routine_stack_id: step.routine_stack_id ?? null,
    }));
}

export function fingerprintRoutineStackSnapshot(
  steps: readonly RoutineStackSnapshotStep[],
): string {
  return crypto
    .createHash("sha256")
    .update(canonicalValue(routineStackFingerprintInput(steps)))
    .digest("hex");
}

export interface RoutineStackMemberProjection {
  id: string;
  role: string;
}

export interface RoutineStackCompactSource {
  stack_id: string;
  version: number;
  fingerprint: string;
  steps: readonly (Pick<
    RoutineStackSnapshotStep,
    "id" | "assigned_to" | "assigned_member_id"
  > & { description?: string | null })[];
  members?: readonly RoutineStackMemberProjection[];
}

/**
 * One unique legacy-account/canonical-subject pair used by the compact
 * mutation receipt. Steps refer to this table by array index, so a 99-step
 * cross-member routine does not repeat long account and subject IDs 99 times.
 */
export type RoutineStackCompactAssignment = readonly [string, string | null];

/**
 * A compact replay-safe projection. Array positions encode display order and
 * assignment indexes resolve through one unique legacy-account/canonical-
 * subject table; member entries contain only canonical IDs/roles. Descriptions,
 * notes, email, photo metadata and other user-authored values never enter a
 * receipt.
 */
export function projectRoutineStackResponse(
  source: RoutineStackCompactSource,
): {
  stack_id: string;
  version: number;
  steps: readonly [string, number, number][];
  assignments: readonly RoutineStackCompactAssignment[];
  members: readonly [string, string][];
  fingerprint: string;
} {
  const assignments: RoutineStackCompactAssignment[] = [];
  const assignmentIndexes = new Map<string, number>();
  const assignmentIndexFor = (
    assignedTo: string,
    assignedMemberId: string | null,
  ): number => {
    const key = `${assignedTo}\u0000${assignedMemberId ?? ""}`;
    const existing = assignmentIndexes.get(key);
    if (existing !== undefined) return existing;
    const index = assignments.length;
    assignments.push([assignedTo, assignedMemberId]);
    assignmentIndexes.set(key, index);
    return index;
  };
  const body = {
    stack_id: source.stack_id,
    version: source.version,
    steps: source.steps.map(
      (step, index) =>
        [
          step.id,
          index + 1,
          assignmentIndexFor(step.assigned_to, step.assigned_member_id ?? null),
        ] as [string, number, number],
    ),
    assignments,
    members: [
      ...new Map(
        (source.members ?? []).map((member) => [
          member.id,
          [member.id, member.role] as [string, string],
        ]),
      ).values(),
    ],
    fingerprint: source.fingerprint,
  };
  const byteLength = Buffer.byteLength(JSON.stringify(body), "utf8");
  if (byteLength > ROUTINE_STACK_RESPONSE_MAX_BYTES) {
    throw new RoutineStackValidationError(
      "ROUTINE_STACK_RESPONSE_TOO_LARGE",
      "The routine stack response is too large to replay safely.",
    );
  }
  return body;
}

export function routineStackResponseByteLength(body: unknown): number {
  return Buffer.byteLength(JSON.stringify(body), "utf8");
}
