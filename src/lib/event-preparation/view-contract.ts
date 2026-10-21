/** Browser-safe strict projection. Internal DB rows/authority never enter it. */
import { z } from "zod";
import {
  memberIdentityIdSchema as id,
  memberProtocolSchema,
} from "@/lib/member-subject-contract";
import { responsibilitySubject } from "@/lib/responsibility";
import { parseCalendarInstant } from "@/lib/calendar-planning/range";
import { isValidTimeZone } from "@/lib/calendar-import/timezone";
import { parseDateOnly } from "@/lib/dates";
import {
  EVENT_PREPARATION_PROTOCOL,
  preparationCue,
  preparationDraftStep,
  preparationStepContent,
  preparationProgress,
} from "./contract";
const token = z.string().regex(/^[a-f0-9]{64}$/);
const instant = z.string().refine((value) => {
  try {
    parseCalendarInstant(value);
    return true;
  } catch {
    return false;
  }
});
const day = z.string().refine((value) => parseDateOnly(value) !== null);
const status = z.enum([
  "pending",
  "in_progress",
  "overdue",
  "completed",
  "verified",
]);
const unavailable = z.object({ id, available: z.literal(false) }).strict();
const task = z.discriminatedUnion("available", [
  unavailable,
  z
    .object({
      id,
      available: z.literal(true),
      title: z.string().max(200),
      description: z.string().max(1000).nullable(),
      subjectName: z.string().max(200),
      sourceToken: token,
      dueDay: day,
      subject: responsibilitySubject,
      status,
      attachedEventId: id.nullable(),
      dateEditable: z.boolean(),
    })
    .strict(),
]);
const number = z.number().int().min(0).max(99);
const progress = z
  .object({
    total: number,
    open: number,
    waitingCheck: number,
    checked: number,
    unavailable: number,
    state: z.enum([
      "unknown",
      "needs-review",
      "not-configured",
      "open",
      "marked-done",
      "checked",
    ]),
  })
  .strict();
const subjectKey = (ref: z.infer<typeof responsibilitySubject>) =>
  ref.kind === "account"
    ? `account:${ref.accountId}`
    : `profile:${ref.memberId}`;
export const preparationViewSchema = z
  .object({
    protocol: z.literal(EVENT_PREPARATION_PROTOCOL),
    owner: z.object({ userId: id, familyId: id }).strict(),
    memberProtocol: memberProtocolSchema,
    timeZone: z.string().max(100).refine(isValidTimeZone),
    evaluatedAt: instant,
    event: z
      .object({
        id,
        title: z.string().max(240),
        start: instant,
        end: instant,
        sourceToken: token,
        active: z.boolean(),
      })
      .strict(),
    expectedToken: token,
    writesEnabled: z.boolean(),
    pointsEnabled: z.boolean(),
    profileWritesEnabled: z.boolean(),
    complete: z.boolean(),
    plan: z
      .object({
        reviewedEventSourceToken: token,
        links: z
          .array(
            z.object({ choreId: id, cue: preparationCue.nullable() }).strict(),
          )
          .max(99),
      })
      .strict()
      .nullable(),
    progress,
    tasks: z.array(task).max(500),
    subjects: z
      .array(
        z
          .object({ subject: responsibilitySubject, name: z.string().max(200) })
          .strict(),
      )
      .max(500),
    routine: z
      .object({
        id,
        label: z.string().max(40),
        sourceToken: token,
        occurrenceDay: day,
        complete: z.boolean(),
        steps: z
          .array(
            z.discriminatedUnion("available", [
              unavailable,
              z
                .object({
                  id,
                  available: z.literal(true),
                  sourceToken: token,
                  content: preparationStepContent,
                })
                .strict(),
            ]),
          )
          .max(99),
      })
      .strict()
      .nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const linked = new Set(value.plan?.links.map((link) => link.choreId) ?? []);
    const shown = value.tasks.filter(
      (task) => task.available && linked.has(task.id),
    );
    const missing = linked.size - shown.length;
    if (
      missing < 0 ||
      new Set(value.tasks.map((task) => task.id)).size !== value.tasks.length ||
      linked.size !== (value.plan?.links.length ?? 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Duplicate preparation sources",
      });
      return;
    }
    const expected = preparationProgress({
      statuses: shown.flatMap((task) => (task.available ? [task.status] : [])),
      unavailable: missing,
      restricted: missing > 0,
      capped: !value.complete,
      eventChanged:
        !!value.plan &&
        value.plan.reviewedEventSourceToken !== value.event.sourceToken,
    });
    const profileAllowed =
      value.memberProtocol === 2 && value.profileWritesEnabled;
    if (
      new Set(value.tasks.map((task) => task.id)).size !== value.tasks.length ||
      linked.size !== (value.plan?.links.length ?? 0) ||
      new Set(value.subjects.map((row) => subjectKey(row.subject))).size !==
        value.subjects.length ||
      (value.routine &&
        new Set(value.routine.steps.map((step) => step.id)).size !==
          value.routine.steps.length) ||
      Object.keys(expected).some(
        (key) =>
          expected[key as keyof typeof expected] !==
          value.progress[key as keyof typeof expected],
      ) ||
      Date.parse(value.event.end) < Date.parse(value.event.start) ||
      (!profileAllowed &&
        (value.subjects.some((row) => row.subject.kind === "profile") ||
          value.tasks.some(
            (task) => task.available && task.subject.kind === "profile",
          ) ||
          value.routine?.steps.some(
            (step) => step.available && step.content.subject.kind === "profile",
          ))) ||
      (!value.pointsEnabled &&
        value.routine?.steps.some(
          (step) => step.available && step.content.points !== 0,
        ))
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Inconsistent preparation projection",
      });
  });
const created = preparationDraftStep.options[1].extend({
  points: z.number().int().min(0).max(1000),
});
export const preparationEffectsSchema = z
  .object({
    reviewedEventSourceToken: token,
    create: z.array(created).max(99),
    ordered: z
      .array(
        z.discriminatedUnion("kind", [
          z
            .object({
              kind: z.literal("existing"),
              choreId: id,
              cue: preparationCue.nullable(),
            })
            .strict(),
          z
            .object({
              kind: z.literal("new"),
              clientId: id,
              cue: preparationCue.nullable(),
            })
            .strict(),
        ]),
      )
      .max(99),
    detach: z.array(id).max(99),
    retime: z
      .array(
        z
          .object({ choreId: id, sourceToken: token, from: day, to: day })
          .strict(),
      )
      .max(99),
    changed: z.boolean(),
  })
  .strict();
export const preparationReadReply = z
  .object({
    view: preparationViewSchema,
    effects: preparationEffectsSchema.nullable(),
    requestHash: token.nullable(),
  })
  .strict()
  .refine((value) => (value.effects === null) === (value.requestHash === null));
export type PreparationReadReply = z.infer<typeof preparationReadReply>;
export type PreparationView = z.infer<typeof preparationViewSchema>;
