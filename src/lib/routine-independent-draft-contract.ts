/** Partial local independent form; identity/revision never masquerade as a stack. */
import { z } from "zod";
import { queueOwnerSchema } from "@/lib/queue-owner-contract";
import {
  routinePartialStep,
  routinePartialSchedule,
} from "@/lib/routine-draft-contract";
import {
  routineIndependentCommand,
  ROUTINE_INDEPENDENT_PROTOCOL,
  type RoutineIndependentState,
} from "@/lib/routine-independent";
export const INDEPENDENT_DRAFT_CONTRACT =
  "herewoven.routine-independent-draft.v1";
const id = z.string().min(1).max(128);
export const independentEditorDraftSchema = z
  .object({
    rootId: id,
    revision: z.number().int().min(1).max(2147483646),
    state: z.enum(["active", "paused", "stopped"]),
    anchor: z.string().max(200),
    schedule: routinePartialSchedule,
    content: routinePartialStep.omit({
      client_step_id: true,
      template_id: true,
    }),
  })
  .strict();
export type IndependentEditorDraft = z.infer<
  typeof independentEditorDraftSchema
>;
export const independentDraftPayload = z
  .object({ userId: id, familyId: id, draft: independentEditorDraftSchema })
  .strict();
export const independentDraftEntry = z
  .object({
    kind: z.literal("local-independent-draft"),
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
        !independentDraftPayload.safeParse(JSON.parse(entry.body)).success
      )
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Invalid local independent draft",
        });
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid local independent draft",
      });
    }
  });
export const independentDraftJournal = z
  .object({
    contract: z.literal(INDEPENDENT_DRAFT_CONTRACT),
    entries: z.array(independentDraftEntry).max(1),
  })
  .strict();
export const independentDraftContext = z
  .object({
    contract: z.literal(INDEPENDENT_DRAFT_CONTRACT),
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
export type IndependentDraftEntry = z.infer<typeof independentDraftEntry>;
export type IndependentDraftContext = z.infer<typeof independentDraftContext>;
export function sanitizeIndependentDraft(
  draft: IndependentEditorDraft,
  pointsEnabled: boolean,
): IndependentEditorDraft {
  return pointsEnabled
    ? draft
    : { ...draft, content: { ...draft.content, points: null } };
}
export function independentDraftFromState(
  state: RoutineIndependentState,
): IndependentEditorDraft {
  return independentEditorDraftSchema.parse({
    rootId: state.rootId,
    revision: state.revision,
    state: state.state,
    anchor: state.anchor ?? "",
    schedule: state.schedule,
    content: { ...state.content, points: state.content.points ?? null },
  });
}
/** Validate the real command separately; incomplete local fields cannot be sent. */
export function independentDraftCommand(
  draft: IndependentEditorDraft,
  context: { userId: string; familyId: string },
  at: Date,
  zone: string,
  viewDay: string,
) {
  return routineIndependentCommand.parse({
    protocol: ROUTINE_INDEPENDENT_PROTOCOL,
    expected_user_id: context.userId,
    expected_family_id: context.familyId,
    issued_at: at.toISOString(),
    view_day: viewDay,
    view_zone: zone,
    root_id: draft.rootId,
    expected_revision: draft.revision,
    scope: "future-after-today",
    action: "replace-future",
    anchor: draft.anchor.trim() || null,
    schedule: draft.schedule,
    content: draft.content,
  });
}

/** Confirmation may clear only its originating draft, never unrelated local work. */
export function independentDraftMatchesCommand(
  draft: IndependentEditorDraft,
  raw: unknown,
): boolean {
  try {
    const command = routineIndependentCommand.parse(raw);
    if (command.action !== "replace-future") return false;
    const rebuilt = independentDraftCommand(
      draft,
      {
        userId: command.expected_user_id,
        familyId: command.expected_family_id,
      },
      new Date(command.issued_at),
      command.view_zone,
      command.view_day,
    );
    return JSON.stringify(rebuilt) === JSON.stringify(command);
  } catch {
    return false;
  }
}
