/** Parent-only catalog/state DTOs. No completion history or identity inference. */
import { z } from "zod";
import {
  routineScheduleConfig,
  routineScheduledStep,
  routineScheduleSubject,
  routineSharedSchedule,
  ROUTINE_SCHEDULE_PROTOCOL,
} from "@/lib/routine-schedule";
import { ROUTINE_NAME_MAX } from "@/lib/routine-icons";
const id = z.string().min(1).max(128);
export const routineScheduleState = z
  .object({
    protocol: z.literal(ROUTINE_SCHEDULE_PROTOCOL),
    userId: id,
    familyId: id,
    stackId: id,
    version: z.number().int().min(1),
    label: z.string().min(1).max(ROUTINE_NAME_MAX),
    pointsEnabled: z.boolean(),
    config: routineScheduleConfig,
    steps: z
      .array(
        routineScheduledStep.extend({
          points: z.number().int().min(0).max(1000).optional(),
        }),
      )
      .min(1)
      .max(99),
  })
  .strict()
  .refine(
    (value) =>
      value.steps.length === value.config.steps.length &&
      value.steps.every(
        (step, index) =>
          step.template_id === value.config.steps[index].template_id &&
          (value.pointsEnabled || step.points === undefined),
      ),
  );
export type RoutineScheduleState = z.infer<typeof routineScheduleState>;
export const routineAssignmentOption = z
  .object({
    subject: routineScheduleSubject,
    name: z.string().min(1).max(200),
    role: z.string().min(1).max(32),
    canRepeat: z.boolean(),
  })
  .strict();
export type RoutineAssignmentOption = z.infer<typeof routineAssignmentOption>;
export const routineCatalogItem = z
  .object({
    stackId: id,
    label: z.string().min(1).max(ROUTINE_NAME_MAX),
    version: z.number().int().min(1),
    state: z.enum(["active", "paused", "stopped", "unsupported"]),
    schedule: routineSharedSchedule.nullable(),
    stepCount: z.number().int().min(1).max(99).nullable(),
  })
  .strict();
export const routineScheduleCatalog = z
  .object({
    protocol: z.literal(ROUTINE_SCHEDULE_PROTOCOL),
    userId: id,
    familyId: id,
    pointsEnabled: z.boolean(),
    routines: z.array(routineCatalogItem).max(20),
    nextCursor: id.nullable(),
    assignments: z.array(routineAssignmentOption).max(1000),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.routines.map((row) => row.stackId)).size ===
        value.routines.length &&
      (value.nextCursor === null ||
        value.nextCursor === value.routines.at(-1)?.stackId),
  );
export type RoutineScheduleCatalog = z.infer<typeof routineScheduleCatalog>;
export function routineSubjectKey(subject: RoutineAssignmentOption["subject"]) {
  return subject.kind === "profile"
    ? `profile:${subject.member_id}`
    : `account:${subject.user_id}:${subject.member_id ?? ""}`;
}
