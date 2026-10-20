/** Future controls for a canonical step explicitly kept outside a routine stack. */
import { z } from "zod";
import {
  routineCommandScope,
  routineScheduleSubject,
  routineSharedSchedule,
  routineScheduledStepDraft,
} from "@/lib/routine-schedule";
export const ROUTINE_INDEPENDENT_PROTOCOL = "herewoven.routine-independent.v1";
const id = z.string().min(1).max(128);
const revision = z.number().int().min(1).max(2147483647);
export const routineIndependentContent = routineScheduledStepDraft.omit({
  client_step_id: true,
  template_id: true,
});
const scope = {
  ...routineCommandScope,
  protocol: z.literal(ROUTINE_INDEPENDENT_PROTOCOL),
  root_id: id,
  expected_revision: revision.max(2147483646),
  scope: z.literal("future-after-today"),
};
export const routineIndependentCommand = z.discriminatedUnion("action", [
  z
    .object({
      ...scope,
      action: z.literal("replace-future"),
      anchor: z.string().trim().max(200).nullable(),
      schedule: routineSharedSchedule,
      content: routineIndependentContent,
    })
    .strict(),
  z.object({ ...scope, action: z.literal("pause") }).strict(),
  z.object({ ...scope, action: z.literal("resume") }).strict(),
  z.object({ ...scope, action: z.literal("stop") }).strict(),
]);
export type RoutineIndependentCommand = z.infer<
  typeof routineIndependentCommand
>;
export const routineIndependentReceipt = z
  .object({
    protocol: z.literal(ROUTINE_INDEPENDENT_PROTOCOL),
    requestId: id,
    rootId: id,
    revision,
    action: z.enum(["replace-future", "pause", "resume", "stop"]),
    state: z.enum(["active", "paused", "stopped"]),
    prunedCount: z.number().int().min(0).max(10000),
  })
  .strict()
  .refine((value) =>
    value.action === "replace-future"
      ? value.state !== "stopped"
      : value.state ===
        ({ pause: "paused", resume: "active", stop: "stopped" } as const)[
          value.action
        ],
  );
export const routineIndependentState = z
  .object({
    protocol: z.literal(ROUTINE_INDEPENDENT_PROTOCOL),
    userId: id,
    familyId: id,
    rootId: id,
    revision,
    state: z.enum(["active", "paused", "stopped"]),
    effectiveOn: routineCommandScope.view_day,
    anchor: z.string().max(200).nullable(),
    schedule: routineSharedSchedule,
    content: routineIndependentContent.extend({
      points: z.number().int().min(0).max(1000).optional(),
      subject: routineScheduleSubject.nullable(),
    }),
    pointsEnabled: z.boolean(),
  })
  .strict()
  .refine((value) => value.pointsEnabled || value.content.points === undefined)
  .refine((value) => value.schedule.starts_on !== null);
export type RoutineIndependentState = z.infer<typeof routineIndependentState>;

export const routineIndependentCatalog = z
  .object({
    protocol: z.literal(ROUTINE_INDEPENDENT_PROTOCOL),
    userId: id,
    familyId: id,
    steps: z
      .array(
        z
          .object({
            rootId: id,
            title: z.string().min(1).max(200),
            revision: revision.nullable(),
            state: z.enum(["active", "paused", "stopped", "unsupported"]),
            schedule: routineSharedSchedule.nullable(),
          })
          .strict(),
      )
      .max(20),
    nextCursor: id.nullable(),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.steps.map((step) => step.rootId)).size ===
        value.steps.length &&
      (value.nextCursor === null ||
        value.nextCursor === value.steps.at(-1)?.rootId),
  );
export type RoutineIndependentCatalog = z.infer<
  typeof routineIndependentCatalog
>;
