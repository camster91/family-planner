/** Editable local form state; deliberately separate from validated send intent. */
import { z } from "zod";
import { ROUTINE_NAME_MAX } from "@/lib/routine-icons";
import { queueOwnerSchema } from "@/lib/queue-owner-contract";
import { routineScheduleSubject } from "@/lib/routine-schedule";
import type { RoutineEditorDraft } from "@/lib/routine-schedule-editor";
export const ROUTINE_DRAFT_CONTRACT = "herewoven.routine-draft.v1";
export const ROUTINE_DRAFT_MAX_BYTES = 2 * 1024 * 1024;
const id = z.string().min(1).max(128);
const step = z
  .object({
    client_step_id: id,
    template_id: id.nullable(),
    title: z.string().max(200),
    description: z.string().max(1000).nullable(),
    subject: routineScheduleSubject.nullable(),
    points: z.number().finite().nullable(),
    difficulty: z.enum(["easy", "medium", "hard"]),
    icon: z.string().max(128).nullable(),
    duration_minutes: z.number().finite().nullable(),
  })
  .strict();
/** Empty/unfinished fields and invalid numeric ranges may be retained, never sent as-is. */
export const routineEditorDraftSchema = z
  .object({
    stackId: id.nullable(),
    version: z.number().int().min(1).nullable(),
    state: z.enum(["active", "paused", "stopped"]),
    label: z.string().max(ROUTINE_NAME_MAX),
    anchor: z.string().max(200),
    schedule: z
      .object({
        frequency: z.enum(["once", "daily", "weekly", "monthly"]),
        starts_on: z.string().max(10).nullable(),
        weekly_days: z.array(z.number().int().min(0).max(6)).max(7),
        monthly_day: z.number().finite().nullable(),
      })
      .strict(),
    steps: z.array(step).min(1).max(99),
    removed: z
      .array(
        z
          .object({
            template_id: id,
            disposition: z.enum(["unstack-future", "stop-future"]),
            step,
            position: z.number().int().min(0).max(98),
            before: id.nullable().default(null),
            after: id.nullable().default(null),
          })
          .strict(),
      )
      .max(99),
  })
  .strict()
  .refine((value) => {
    const roots = [
      ...value.steps.flatMap((row) =>
        row.template_id ? [row.template_id] : [],
      ),
      ...value.removed.map((row) => row.template_id),
    ];
    const clients = [
      ...value.steps,
      ...value.removed.map((row) => row.step),
    ].map((row) => row.client_step_id);
    return (
      (value.stackId === null) === (value.version === null) &&
      new Set(roots).size === roots.length &&
      new Set(clients).size === clients.length &&
      value.removed.every((row) => row.template_id === row.step.template_id)
    );
  });
export const routineDraftPayload = z
  .object({ userId: id, familyId: id, draft: routineEditorDraftSchema })
  .strict();
export const routineDraftEntry = z
  .object({
    kind: z.literal("local-routine-draft"),
    key: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
    body: z
      .string()
      .min(1)
      .max(1024 * 1024),
  })
  .strict()
  .superRefine((entry, ctx) => {
    try {
      if (
        new TextEncoder().encode(entry.body).byteLength > 1024 * 1024 ||
        !routineDraftPayload.safeParse(JSON.parse(entry.body)).success
      )
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Invalid local routine draft",
        });
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid local routine draft",
      });
    }
  });
export const routineDraftJournal = z
  .object({
    contract: z.literal(ROUTINE_DRAFT_CONTRACT),
    entries: z.array(routineDraftEntry).max(1),
  })
  .strict();
export const routineDraftContext = z
  .object({
    contract: z.literal(ROUTINE_DRAFT_CONTRACT),
    userId: id,
    familyId: id,
    enabled: z.boolean(),
    pointsEnabled: z.boolean(),
    owner: queueOwnerSchema
      .refine((owner) => owner.kind === "person")
      .nullable(),
  })
  .strict()
  .refine(
    (value) =>
      (!value.enabled || value.owner !== null) &&
      (!value.owner || value.owner.ownerId === value.userId),
  );
export type RoutineDraftEntry = z.infer<typeof routineDraftEntry>;
export type RoutineDraftContext = z.infer<typeof routineDraftContext>;
export function sanitizeRoutineDraftPoints(
  draft: RoutineEditorDraft,
  pointsEnabled: boolean,
): RoutineEditorDraft {
  return pointsEnabled
    ? draft
    : {
        ...draft,
        steps: draft.steps.map((row) => ({ ...row, points: null })),
        removed: draft.removed.map((row) => ({
          ...row,
          step: { ...row.step, points: null },
        })),
      };
}
