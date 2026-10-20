import { z } from "zod";
import { parseDateOnly } from "@/lib/dates";
import { canRoleAccessPath } from "@/lib/kid-access";
import { isFeatureEnabled, type FamilyFeatures } from "@/lib/features";
export const WEEKLY_RESET_PROTOCOL = "herewoven.weekly-reset.v1" as const;
export const WEEKLY_RESET_READY_ENV = "FAMILY_WEEKLY_RESET_READY";
export const weeklyResetReady = () =>
  process.env[WEEKLY_RESET_READY_ENV] === "1";
export const WEEKLY_RESET_STEPS = [
  "schedule",
  "responsibilities",
  "meals",
  "prep",
  "food",
  "groceries",
] as const;
export const weeklyResetStep = z.enum(WEEKLY_RESET_STEPS);
export const weeklyResetStepState = z.enum(["pending", "reviewed", "skipped"]);
const familyId = z.string().min(1).max(128);
const weekStart = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = parseDateOnly(value);
    return !!date && date.getUTCFullYear() >= 1970 && date.getUTCDay() === 1;
  });
const timeZone = z
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
  });
export const weeklyResetScope = z.object({ weekStart, timeZone }).strict();
const steps = z
  .object({
    schedule: weeklyResetStepState.optional(),
    responsibilities: weeklyResetStepState.optional(),
    meals: weeklyResetStepState.optional(),
    prep: weeklyResetStepState.optional(),
    food: weeklyResetStepState.optional(),
    groceries: weeklyResetStepState.optional(),
  })
  .strict();
export const weeklyResetRecord = z
  .object({
    protocol: z.literal(WEEKLY_RESET_PROTOCOL),
    familyId,
    weekStart,
    timeZone,
    steps,
    finishedAt: z.string().datetime().nullable(),
  })
  .strict();
const commandScope = {
  protocol: z.literal(WEEKLY_RESET_PROTOCOL),
  familyId,
  userId: familyId,
  issuedAt: z.string().datetime(),
  weekStart,
  timeZone,
  expectedRevision: z.number().int().min(0).max(2147483646),
};
export const weeklyResetCommand = z.discriminatedUnion("action", [
  z.object({ ...commandScope, action: z.literal("start") }).strict(),
  z.object({ ...commandScope, action: z.literal("restart") }).strict(),
  z.object({ ...commandScope, action: z.literal("finish") }).strict(),
  z
    .object({
      ...commandScope,
      action: z.literal("set-step"),
      step: weeklyResetStep,
      state: weeklyResetStepState,
    })
    .strict(),
]);
export type WeeklyResetScope = z.infer<typeof weeklyResetScope>;
export type WeeklyResetRecord = z.infer<typeof weeklyResetRecord>;
export type WeeklyResetCommand = z.infer<typeof weeklyResetCommand>;
export type WeeklyResetStep = z.infer<typeof weeklyResetStep>;
export const weeklyResetView = z
  .object({
    protocol: z.literal(WEEKLY_RESET_PROTOCOL),
    owner: z.object({ userId: familyId, familyId }).strict(),
    scope: weeklyResetScope,
    revision: z.number().int().nonnegative(),
    started: z.boolean(),
    steps: z
      .array(
        z
          .object({
            id: weeklyResetStep,
            href: z.enum([
              "/dashboard/today",
              "/dashboard/calendar",
              "/dashboard/chores",
              "/dashboard/pickups",
              "/dashboard/meals",
              "/dashboard/inventory",
              "/dashboard/lists/groceries",
            ]),
            state: weeklyResetStepState,
          })
          .strict(),
      )
      .max(6),
    finishedAt: z.string().datetime().nullable(),
    complete: z.boolean(),
  })
  .strict();
export type WeeklyResetView = z.infer<typeof weeklyResetView>;
export function weeklyResetSections(
  role: string,
  features: FamilyFeatures,
): Array<{ id: WeeklyResetStep; href: string }> {
  if (!["parent", "teen", "child"].includes(role)) return [];
  const allowed = (path: string, feature: keyof FamilyFeatures) =>
    isFeatureEnabled(features, feature) && canRoleAccessPath(role, path);
  const result: Array<{ id: WeeklyResetStep; href: string }> = [
    {
      id: "schedule",
      href: allowed("/dashboard/calendar", "calendar")
        ? "/dashboard/calendar"
        : "/dashboard/today",
    },
  ];
  if (
    isFeatureEnabled(features, "chores") ||
    allowed("/dashboard/pickups", "pickups") ||
    allowed("/dashboard/handoff", "handoff")
  )
    result.push({
      id: "responsibilities",
      href: allowed("/dashboard/chores", "chores")
        ? "/dashboard/chores"
        : allowed("/dashboard/pickups", "pickups")
          ? "/dashboard/pickups"
          : "/dashboard/today",
    });
  if (allowed("/dashboard/meals", "meals"))
    result.push(
      { id: "meals", href: "/dashboard/meals" },
      { id: "prep", href: "/dashboard/meals" },
    );
  if (allowed("/dashboard/inventory", "inventory"))
    result.push({ id: "food", href: "/dashboard/inventory" });
  if (allowed("/dashboard/lists", "lists"))
    result.push({ id: "groceries", href: "/dashboard/lists/groceries" });
  return result;
}
export function weeklyResetMatches(
  record: WeeklyResetRecord | null,
  family: string,
  scope: WeeklyResetScope,
) {
  return (
    !!record &&
    record.familyId === family &&
    record.weekStart === scope.weekStart &&
    record.timeZone === scope.timeZone
  );
}

export class WeeklyResetError extends Error {
  constructor(
    readonly code:
      | "UNAUTHORIZED"
      | "FORBIDDEN"
      | "CONFLICT"
      | "UNSUPPORTED"
      | "SCOPE_CHANGED"
      | "STEP_UNAVAILABLE"
      | "INCOMPLETE"
      | "UNAVAILABLE",
  ) {
    super(code);
  }
}
/** Review metadata only: this never completes, assigns or changes a domain row. */
export function planWeeklyReset(
  record: WeeklyResetRecord | null,
  command: WeeklyResetCommand,
  role: string,
  features: FamilyFeatures,
  now: Date,
): WeeklyResetRecord {
  const same = weeklyResetMatches(record, command.familyId, command);
  if (command.action === "start")
    return same
      ? record!
      : {
          protocol: WEEKLY_RESET_PROTOCOL,
          familyId: command.familyId,
          weekStart: command.weekStart,
          timeZone: command.timeZone,
          steps: {},
          finishedAt: null,
        };
  if (!same || !record) throw new WeeklyResetError("SCOPE_CHANGED");
  if (command.action === "restart")
    return { ...record, steps: {}, finishedAt: null };
  const sections = weeklyResetSections(role, features);
  if (command.action === "set-step") {
    if (!sections.some((row) => row.id === command.step))
      throw new WeeklyResetError("STEP_UNAVAILABLE");
    return {
      ...record,
      steps: { ...record.steps, [command.step]: command.state },
      finishedAt: null,
    };
  }
  if (
    sections.some(
      (row) => !record.steps[row.id] || record.steps[row.id] === "pending",
    )
  )
    throw new WeeklyResetError("INCOMPLETE");
  return record.finishedAt
    ? record
    : { ...record, finishedAt: now.toISOString() };
}
export const weeklyResetReceipt = z
  .object({
    receipt: z
      .object({
        protocol: z.literal(WEEKLY_RESET_PROTOCOL),
        familyId,
        userId: familyId,
        weekStart,
        timeZone,
        revision: z.number().int().min(0),
        action: z.enum(["start", "restart", "set-step", "finish"]),
      })
      .strict(),
  })
  .strict();
