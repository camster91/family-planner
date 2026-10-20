/**
 * Durable future-routine contract (#450). Pure preparation only: no writes,
 * expansion, identity adoption or change to the current-occurrence protocol.
 */
import { z } from "zod";
import { parseDateOnly } from "@/lib/dates";
import { monthlyChoreDate, nextDueDate } from "@/lib/chore-recurrence-dates";
import { nextSelectedWeekday } from "@/lib/chore-weekdays";
import { isRoutineIconKey, ROUTINE_NAME_MAX } from "@/lib/routine-icons";
const id = z.string().min(1).max(128);
const day = z
  .string()
  .refine((value) => parseDateOnly(value) !== null, "Invalid calendar day");
const weekdayArray = z.array(z.number().int().min(0).max(6)).max(7);
export const ROUTINE_SCHEDULE_PROTOCOL = "herewoven.routine-schedule.v1";
export const ROUTINE_SCHEDULE_MAX_STEPS = 99;
export const ROUTINE_SCHEDULE_MAX_BYTES = 256 * 1024;
export const routineSharedSchedule = z
  .object({
    frequency: z.enum(["once", "daily", "weekly", "monthly"]),
    starts_on: day.nullable(),
    weekly_days: weekdayArray,
    monthly_day: z.number().int().min(1).max(31).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      new Set(value.weekly_days).size !== value.weekly_days.length ||
      (value.frequency === "weekly"
        ? !value.weekly_days.length
        : value.weekly_days.length > 0)
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["weekly_days"],
        message: "Choose distinct weekdays only for a weekly routine.",
      });
    if ((value.frequency === "monthly") !== (value.monthly_day !== null))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["monthly_day"],
        message: "A monthly routine needs its original day of month.",
      });
  })
  .transform((value) => ({
    ...value,
    weekly_days: [...value.weekly_days].sort((a, b) => a - b),
  }));
export type RoutineSharedSchedule = z.infer<typeof routineSharedSchedule>;
export const routineScheduleSubject = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("account"),
      user_id: id,
      member_id: id.nullable(),
    })
    .strict(),
  z.object({ kind: z.literal("profile"), member_id: id }).strict(),
]);
const stepContent = {
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).nullable(),
  subject: routineScheduleSubject,
  points: z.number().int().min(0).max(1000),
  difficulty: z.enum(["easy", "medium", "hard"]),
  icon: z.string().refine(isRoutineIconKey).nullable(),
  duration_minutes: z.number().int().min(1).max(1440).nullable(),
};
export const routineScheduledStepDraft = z
  .object({
    client_step_id: id,
    /** Canonical root Chore ID. Null means explicitly create a new step. */
    template_id: id.nullable(),
    ...stepContent,
  })
  .strict();
export const routineScheduledStep = z
  .object({ template_id: id, ...stepContent })
  .strict();
const distinctSteps = (steps: { template_id: string }[]) =>
  new Set(steps.map((step) => step.template_id)).size === steps.length;
/** Future-step content lives on its canonical root, separately from past occurrence fields.
 * When unstacked, this definition keeps its last reviewed schedule and continues
 * independently; no historical Chore title/owner/date is overwritten. */
export const routineStepSeriesConfig = z
  .object({
    protocol: z.literal("herewoven.routine-step-series.v1"),
    stack_id: id.nullable(),
    state: z.enum(["active", "paused", "stopped"]),
    effective_on: day,
    anchor: z.string().trim().max(200).nullable(),
    schedule: routineSharedSchedule,
    content: z.object(stepContent).strict(),
  })
  .strict()
  .refine(
    (value) => value.schedule.starts_on !== null,
    "Stored step series needs its reviewed start day",
  );
export type RoutineStepSeriesConfig = z.infer<typeof routineStepSeriesConfig>;
export const routineScheduleConfig = z
  .object({
    protocol: z.literal(ROUTINE_SCHEDULE_PROTOCOL),
    state: z.enum(["active", "paused", "stopped"]),
    effective_on: day,
    /** An authored habit cue, not an automatic trigger or notification. */
    anchor: z.string().trim().max(200).nullable(),
    schedule: routineSharedSchedule,
    steps: z
      .array(z.object({ template_id: id }).strict())
      .min(1)
      .max(ROUTINE_SCHEDULE_MAX_STEPS),
  })
  .strict()
  .refine(
    (value) => value.schedule.starts_on !== null && distinctSteps(value.steps),
    "Stored routine needs explicit start and unique canonical steps",
  );
export type RoutineScheduleConfig = z.infer<typeof routineScheduleConfig>;
const scope = {
  protocol: z.literal(ROUTINE_SCHEDULE_PROTOCOL),
  expected_user_id: id,
  expected_family_id: id,
  issued_at: z.string().datetime(),
  /** Viewer-local calendar day, captured with the original request. */
  view_day: day,
  view_zone: z
    .string()
    .min(1)
    .max(100)
    .refine((value) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }, "Choose a supported viewer timezone"),
};
const draft = {
  label: z.string().trim().min(1).max(ROUTINE_NAME_MAX),
  anchor: z.string().trim().max(200).nullable(),
  schedule: routineSharedSchedule,
  steps: z
    .array(routineScheduledStepDraft)
    .min(1)
    .max(ROUTINE_SCHEDULE_MAX_STEPS),
};
export const routineScheduleCommand = z
  .discriminatedUnion("action", [
    z.object({ ...scope, action: z.literal("create"), ...draft }).strict(),
    z
      .object({
        ...scope,
        action: z.literal("replace-future"),
        stack_id: id,
        expected_version: z.number().int().min(1),
        ...draft,
        removed_steps: z
          .array(
            z
              .object({
                template_id: id,
                disposition: z.enum(["unstack-future", "stop-future"]),
              })
              .strict(),
          )
          .max(ROUTINE_SCHEDULE_MAX_STEPS),
      })
      .strict(),
    z
      .object({
        ...scope,
        action: z.literal("pause"),
        stack_id: id,
        expected_version: z.number().int().min(1),
        scope: z.literal("future-after-today"),
      })
      .strict(),
    z
      .object({
        ...scope,
        action: z.literal("resume"),
        stack_id: id,
        expected_version: z.number().int().min(1),
        scope: z.literal("future-after-today"),
      })
      .strict(),
    z
      .object({
        ...scope,
        action: z.literal("stop"),
        stack_id: id,
        expected_version: z.number().int().min(1),
        scope: z.literal("future-after-today"),
      })
      .strict(),
  ])
  .superRefine((command, context) => {
    if (command.action !== "create" && command.action !== "replace-future")
      return;
    const clients = command.steps.map((step) => step.client_step_id),
      roots = command.steps.flatMap((step) =>
        step.template_id ? [step.template_id] : [],
      );
    const removed =
      command.action === "replace-future"
        ? command.removed_steps.map((step) => step.template_id)
        : [];
    if (
      new Set(clients).size !== clients.length ||
      new Set(roots).size !== roots.length ||
      new Set(removed).size !== removed.length ||
      removed.some((root) => roots.includes(root))
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["steps"],
        message: "A step cannot be duplicated or both retained and removed.",
      });
    if (command.action === "create" && roots.length)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["steps"],
        message:
          "Creating a routine cannot adopt existing chores by ID or label.",
      });
  });
export type RoutineScheduleCommand = z.infer<typeof routineScheduleCommand>;

/** Explicit local fallback, never UTC-now or a guessed household timezone. */
export function normalizeRoutineSharedSchedule(
  input: RoutineSharedSchedule,
  viewDay: string,
): RoutineSharedSchedule & { starts_on: string } {
  const value = routineSharedSchedule.parse(input);
  const fallback = day.parse(viewDay);
  return { ...value, starts_on: value.starts_on ?? fallback };
}
function dayString(date: Date) {
  return day.parse(date.toISOString().slice(0, 10));
}
/** First matching UTC date-only day; monthly clamping never changes the anchor. */
export function firstRoutineOccurrence(
  input: RoutineSharedSchedule,
  viewDay: string,
  notBefore?: string,
): string {
  const schedule = normalizeRoutineSharedSchedule(input, viewDay);
  const floor = [
    schedule.starts_on,
    ...(notBefore ? [day.parse(notBefore)] : []),
  ]
    .sort()
    .at(-1)!;
  const date = parseDateOnly(floor)!;
  if (schedule.frequency === "weekly")
    return dayString(nextSelectedWeekday(date, schedule.weekly_days, true)!);
  if (schedule.frequency !== "monthly") return floor;
  let result = monthlyChoreDate(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    schedule.monthly_day!,
  );
  if (result < date)
    result = monthlyChoreDate(
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      schedule.monthly_day!,
    );
  return dayString(result);
}
export function nextRoutineOccurrence(
  input: RoutineSharedSchedule,
  after: string,
): string | null {
  const schedule = routineSharedSchedule.parse(input),
    date = parseDateOnly(day.parse(after))!;
  const next = nextDueDate(
    date,
    schedule.frequency,
    schedule.weekly_days,
    schedule.monthly_day ?? date.getUTCDate(),
  );
  return next ? dayString(next) : null;
}
/** Resume skips missed days; it does not synthesize completed or overdue catch-up. */
export function routineResumeDay(
  config: RoutineScheduleConfig,
  viewDay: string,
) {
  const saved = routineScheduleConfig.parse(config);
  if (saved.state === "stopped")
    throw new Error(
      "A stopped routine needs a new explicit routine; it cannot resume.",
    );
  day.parse(viewDay);
  if (saved.schedule.frequency === "once")
    return saved.schedule.starts_on! > viewDay
      ? saved.schedule.starts_on
      : null;
  const tomorrow = parseDateOnly(day.parse(viewDay))!;
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return firstRoutineOccurrence(saved.schedule, viewDay, dayString(tomorrow));
}
export const routineFutureSnapshot = z
  .object({
    id,
    family_id: id,
    routine_stack_id: id,
    recurrence_id: id,
    is_template: z.boolean(),
    due_day: day,
    status: z.string().max(32),
    photo_url: z.string().nullable(),
    photo_verified: z.boolean(),
    verified_at: z.string().datetime().nullable(),
    verified_notes: z.string().nullable(),
    completed_at: z.string().datetime().nullable(),
    successor_id: id.nullable(),
    member_subject_erased: z.boolean(),
  })
  .strict();
export type RoutineFutureSnapshot = z.infer<typeof routineFutureSnapshot>;
/** Conservative partition only. The command transaction must lock/recheck rows. */
export function planRoutineFutureRows(input: {
  familyId: string;
  stackId: string;
  templateIds: string[];
  viewDay: string;
  rows: RoutineFutureSnapshot[];
}) {
  day.parse(input.viewDay);
  if (
    !input.templateIds.length ||
    new Set(input.templateIds).size !== input.templateIds.length ||
    input.rows.length > 10000
  )
    throw new Error("Invalid future-routine snapshot");
  const templates = new Set(input.templateIds),
    seen = new Set<string>();
  const pruneIds: string[] = [],
    preserveIds: string[] = [];
  for (const raw of input.rows) {
    const row = routineFutureSnapshot.parse(raw);
    if (
      seen.has(row.id) ||
      row.family_id !== input.familyId ||
      row.routine_stack_id !== input.stackId ||
      !templates.has(row.recurrence_id)
    )
      throw new Error("Future-routine ownership or identity changed");
    seen.add(row.id);
    const untouched =
      row.status === "pending" &&
      !row.photo_url &&
      !row.photo_verified &&
      !row.verified_at &&
      !row.verified_notes &&
      !row.completed_at &&
      !row.successor_id &&
      !row.member_subject_erased;
    if (
      row.due_day > input.viewDay &&
      untouched &&
      !row.is_template &&
      !templates.has(row.id)
    )
      pruneIds.push(row.id);
    else preserveIds.push(row.id);
  }
  return { pruneIds, preserveIds };
}
/** Require a deliberate policy for every removed canonical step, never title matching. */
export function validateRoutineStepTransition(
  prior: RoutineScheduleConfig,
  command: Extract<RoutineScheduleCommand, { action: "replace-future" }>,
) {
  const config = routineScheduleConfig.parse(prior),
    input = routineScheduleCommand.parse(command);
  if (input.action !== "replace-future" || config.state === "stopped")
    throw new Error("Routine cannot be replaced");
  const known = new Set(config.steps.map((step) => step.template_id));
  const retained = new Set(
    input.steps.flatMap((step) => (step.template_id ? [step.template_id] : [])),
  );
  const removed = new Set(input.removed_steps.map((step) => step.template_id));
  if (
    [...retained, ...removed].some((root) => !known.has(root)) ||
    [...known].some((root) => !retained.has(root) && !removed.has(root))
  )
    throw new Error(
      "Every original step must be explicitly retained or removed with a policy",
    );
  return input;
}

/** Day guard for a first effect, never rebase an original retry body at midnight. */
export function routineViewerDay(zone: string, now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    calendar: "gregory",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return day.parse(`${get("year")}-${get("month")}-${get("day")}`);
}
export const routineScheduleReceipt = z
  .object({
    protocol: z.literal(ROUTINE_SCHEDULE_PROTOCOL),
    requestId: id,
    stackId: id,
    version: z.number().int().min(1),
    action: z.enum(["create", "replace-future", "pause", "resume", "stop"]),
    state: z.enum(["active", "paused", "stopped"]),
    roots: z.array(id).min(1).max(ROUTINE_SCHEDULE_MAX_STEPS),
    prunedCount: z.number().int().nonnegative().max(10000),
    unstackedCount: z.number().int().nonnegative().max(10000),
  })
  .strict()
  .refine((value) => new Set(value.roots).size === value.roots.length);
