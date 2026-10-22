/** Event-linked preparation controls canonical chores; this pure contract is
 * not an authorization endpoint or a second task/completion store. */
import { z } from "zod";
import {
  memberIdentityIdSchema as id,
  memberProtocolSchema,
} from "@/lib/member-subject-contract";
import {
  responsibilitySubject,
  type ResponsibilitySubject,
} from "@/lib/responsibility";
import { isRoutineIconKey } from "@/lib/routine-icons";
import { parseDateOnly } from "@/lib/dates";
import { dayKeyFor } from "@/lib/local-day-key";
import { isValidTimeZone } from "@/lib/calendar-import/timezone";
import { parseCalendarInstant } from "@/lib/calendar-planning/range";
export const EVENT_PREPARATION_PROTOCOL =
  "herewoven.event-preparation.v1" as const;
export const EVENT_PREPARATION_MAX_STEPS = 99;
const token = z.string().regex(/^[a-f0-9]{64}$/);
const day = z.string().refine((value) => parseDateOnly(value) !== null);
const instant = z.string().refine((value) => {
  try {
    parseCalendarInstant(value);
    return true;
  } catch {
    return false;
  }
});
export const preparationCue = z
  .object({
    anchor: z.enum(["start", "end"]),
    direction: z.enum(["before", "after"]),
    minutes: z.number().int().min(0).max(525600),
  })
  .strict();
export type PreparationCue = z.infer<typeof preparationCue>;
const content = {
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).nullable(),
  subject: responsibilitySubject,
  points: z.number().int().min(0).max(1000).nullable(),
  difficulty: z.enum(["easy", "medium", "hard"]),
  icon: z.string().refine(isRoutineIconKey).nullable(),
  durationMinutes: z.number().int().min(1).max(1440).nullable(),
};
export const preparationStepContent = z.object(content).strict();
const existing = z
  .object({
    kind: z.literal("existing"),
    choreId: id,
    sourceToken: token,
    cue: preparationCue.nullable(),
    retimeTo: day.nullable(),
  })
  .strict();
const create = z
  .object({
    kind: z.literal("new"),
    clientId: id,
    ...content,
    dueDay: day,
    cue: preparationCue.nullable(),
  })
  .strict();
export const preparationDraftStep = z.discriminatedUnion("kind", [
  existing,
  create,
]);
export type PreparationDraftStep = z.infer<typeof preparationDraftStep>;
const base = {
  protocol: z.literal(EVENT_PREPARATION_PROTOCOL),
  owner: z.object({ userId: id, familyId: id }).strict(),
  memberProtocol: memberProtocolSchema,
  eventId: id,
  eventSourceToken: token,
  expectedToken: token,
  timeZone: z.string().max(100).refine(isValidTimeZone),
  issuedAt: instant,
  eventChangeDecision: z.enum(["keep-dates", "retime-selected"]).nullable(),
};
const setPlan = z
  .object({
    ...base,
    action: z.literal("set-plan"),
    steps: z.array(preparationDraftStep).max(EVENT_PREPARATION_MAX_STEPS),
  })
  .strict();
const reuse = z
  .object({
    ...base,
    action: z.literal("reuse-routine"),
    stackId: id,
    sourceToken: token,
    occurrenceDay: day,
    steps: z
      .array(
        z
          .object({
            sourceId: id,
            sourceToken: token,
            clientId: id,
            subject: responsibilitySubject,
            points: content.points,
            dueDay: day,
            cue: preparationCue.nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(EVENT_PREPARATION_MAX_STEPS),
  })
  .strict();
export const preparationCommand = z.discriminatedUnion("action", [
  setPlan,
  reuse,
]);
export type PreparationCommand = z.infer<typeof preparationCommand>;
export type PreparationTask = {
  id: string;
  sourceToken: string;
  dueDay: string;
  subject: ResponsibilitySubject | null;
  status: "pending" | "in_progress" | "overdue" | "completed" | "verified";
  attachedEventId: string | null;
  linkable: boolean;
  dateEditable: boolean;
};
export type PreparationLink = { choreId: string; cue: PreparationCue | null };
export type PreparationContext = {
  actor:
    | {
        kind: "person";
        userId: string;
        familyId: string;
        role: string;
        memberProtocol: 1 | 2;
      }
    | { kind: "device"; familyId: string };
  event: {
    id: string;
    familyId: string;
    sourceToken: string;
    start: string;
    end: string;
    active: boolean;
  };
  timeZone: string;
  viewToken: string;
  writesEnabled: boolean;
  pointsEnabled: boolean;
  profileWritesEnabled: boolean;
  complete: boolean;
  current: {
    reviewedEventSourceToken: string;
    links: PreparationLink[];
  } | null;
  eligibleSubjects: ResponsibilitySubject[];
  tasks: PreparationTask[];
  routine: {
    id: string;
    sourceToken: string;
    occurrenceDay: string;
    complete: boolean;
    steps: {
      id: string;
      sourceToken: string;
      copyable: boolean;
      content: Omit<
        z.infer<typeof create>,
        "kind" | "clientId" | "dueDay" | "cue"
      > | null;
    }[];
  } | null;
};
export class EventPreparationError extends Error {
  constructor(
    public readonly code:
      | "INVALID"
      | "UNAUTHORIZED"
      | "NOT_FOUND"
      | "UNSUPPORTED"
      | "FORBIDDEN"
      | "UNAVAILABLE"
      | "STALE"
      | "EXPIRED"
      | "CLOSED"
      | "REVIEW_REQUIRED"
      | "SUBJECT_UNAVAILABLE"
      | "ALREADY_LINKED"
      | "TASK_UNAVAILABLE"
      | "DATE_LOCKED"
      | "CUE_MISMATCH"
      | "POINTS_DISABLED",
  ) {
    super("Event preparation needs a fresh authorized review");
  }
}
const fail = (code: EventPreparationError["code"]): never => {
  throw new EventPreparationError(code);
};
const subjectKey = (subject: ResponsibilitySubject) =>
  subject.kind === "account"
    ? `account:${subject.accountId}`
    : `profile:${subject.memberId}`;
export function preparationDueDay(
  event: PreparationContext["event"],
  cue: PreparationCue,
  timeZone: string,
): string {
  const parsed = preparationCue.safeParse(cue);
  if (!parsed.success || !isValidTimeZone(timeZone)) return fail("INVALID");
  const anchor = parseCalendarInstant(
      cue.anchor === "start" ? event.start : event.end,
    ),
    when = new Date(
      +anchor + (cue.direction === "before" ? -1 : 1) * cue.minutes * 60000,
    ),
    key = dayKeyFor({ kind: "tz", timeZone })(when);
  if (!parseDateOnly(key)) return fail("CUE_MISMATCH");
  return key;
}
export type PreparationEffects = {
  reviewedEventSourceToken: string;
  create: (Omit<Extract<PreparationDraftStep, { kind: "new" }>, "points"> & {
    points: number;
    origin?: { stackId: string; sourceChoreId: string; occurrenceDay: string };
  })[];
  ordered: (
    | { kind: "existing"; choreId: string; cue: PreparationCue | null }
    | { kind: "new"; clientId: string; cue: PreparationCue | null }
  )[];
  detach: string[];
  retime: { choreId: string; sourceToken: string; from: string; to: string }[];
  changed: boolean;
};
/** Caller supplies fresh locked canonical context. No profile authenticates,
 * no completed status/credit is copied, and omitting a link never deletes work. */
export function planEventPreparation(
  raw: unknown,
  context: PreparationContext,
  now: Date,
): PreparationEffects {
  const parsed = preparationCommand.safeParse(raw);
  if (!parsed.success) return fail("INVALID");
  const command = parsed.data;
  if (
    context.actor.kind !== "person" ||
    context.actor.role !== "parent" ||
    command.owner.userId !== context.actor.userId ||
    command.owner.familyId !== context.actor.familyId ||
    context.event.familyId !== context.actor.familyId ||
    command.eventId !== context.event.id
  )
    return fail("FORBIDDEN");
  if (command.memberProtocol !== context.actor.memberProtocol)
    return fail("FORBIDDEN");
  if (!context.writesEnabled || !context.complete) return fail("UNAVAILABLE");
  if (!context.event.active) return fail("CLOSED");
  try {
    if (
      +parseCalendarInstant(context.event.end) <
      +parseCalendarInstant(context.event.start)
    )
      return fail("UNAVAILABLE");
  } catch {
    return fail("UNAVAILABLE");
  }
  if (command.timeZone !== context.timeZone) return fail("STALE");
  const age = +now - Date.parse(command.issuedAt);
  if (!Number.isFinite(age) || age < -60000 || age > 15 * 60000)
    return fail("EXPIRED");
  if (
    command.expectedToken !== context.viewToken ||
    command.eventSourceToken !== context.event.sourceToken
  )
    return fail("STALE");
  const eventChanged =
    !!context.current &&
    context.current.reviewedEventSourceToken !== context.event.sourceToken;
  if (eventChanged && command.eventChangeDecision === null)
    return fail("REVIEW_REQUIRED");
  if (
    context.eligibleSubjects.some(
      (value) => !responsibilitySubject.safeParse(value).success,
    ) ||
    new Set(context.tasks.map((task) => task.id)).size !==
      context.tasks.length ||
    (context.current &&
      new Set(context.current.links.map((link) => link.choreId)).size !==
        context.current.links.length)
  )
    return fail("UNAVAILABLE");
  const allowed = new Set(context.eligibleSubjects.map(subjectKey));
  function subject(value: ResponsibilitySubject) {
    if (
      value.kind === "profile" &&
      (command.memberProtocol !== 2 || !context.profileWritesEnabled)
    )
      return fail("SUBJECT_UNAVAILABLE");
    if (!allowed.has(subjectKey(value))) return fail("SUBJECT_UNAVAILABLE");
  }
  function points(value: number | null, fallback = 0) {
    const result = value ?? (context.pointsEnabled ? fallback : 0);
    if (!context.pointsEnabled && result > 0) return fail("POINTS_DISABLED");
    return result;
  }
  const origins = new Map<
    string,
    NonNullable<PreparationEffects["create"][number]["origin"]>
  >();
  let steps: PreparationDraftStep[];
  if (command.action === "reuse-routine") {
    const routine = context.routine;
    if (
      !routine ||
      !routine.complete ||
      routine.steps.length > EVENT_PREPARATION_MAX_STEPS ||
      new Set(routine.steps.map((step) => step.id)).size !==
        routine.steps.length ||
      routine.id !== command.stackId ||
      routine.sourceToken !== command.sourceToken ||
      routine.occurrenceDay !== command.occurrenceDay
    )
      return fail("STALE");
    if (
      new Set(command.steps.map((step) => step.sourceId)).size !==
      command.steps.length
    )
      return fail("INVALID");
    // Reuse appends distinct new canonical work; it never replaces existing links.
    steps = (context.current?.links ?? []).map((link) => {
      const task = context.tasks.find((task) => task.id === link.choreId);
      if (!task) return fail("TASK_UNAVAILABLE");
      return {
        kind: "existing",
        choreId: task.id,
        sourceToken: task.sourceToken,
        cue: link.cue ? { ...link.cue } : null,
        retimeTo: null,
      };
    });
    steps.push(
      ...command.steps.map((step) => {
        const source = routine.steps.find((row) => row.id === step.sourceId);
        if (
          !source ||
          !source.copyable ||
          !source.content ||
          source.sourceToken !== step.sourceToken
        )
          return fail("STALE");
        origins.set(step.clientId, {
          stackId: routine.id,
          sourceChoreId: source.id,
          occurrenceDay: routine.occurrenceDay,
        });
        return {
          kind: "new" as const,
          clientId: step.clientId,
          ...source.content,
          subject: step.subject,
          points: points(step.points, source.content.points ?? 0),
          dueDay: step.dueDay,
          cue: step.cue,
        };
      }),
    );
  } else steps = command.steps;
  if (
    steps.length > EVENT_PREPARATION_MAX_STEPS ||
    new Set(
      steps.map((step) =>
        step.kind === "new"
          ? `new:${step.clientId}`
          : `existing:${step.choreId}`,
      ),
    ).size !== steps.length
  )
    return fail("INVALID");
  const tasks = new Map(context.tasks.map((task) => [task.id, task])),
    created: PreparationEffects["create"] = [],
    ordered: PreparationEffects["ordered"] = [],
    retime: PreparationEffects["retime"] = [];
  for (const step of steps) {
    if (step.kind === "new") {
      subject(step.subject);
      const final = { ...step, points: points(step.points) };
      if (
        step.cue &&
        preparationDueDay(context.event, step.cue, command.timeZone) !==
          step.dueDay
      )
        return fail("CUE_MISMATCH");
      const checked = create.safeParse(final);
      if (!checked.success) return fail("INVALID");
      const origin = origins.get(step.clientId);
      created.push({
        ...checked.data,
        points: final.points,
        ...(origin ? { origin } : {}),
      });
      ordered.push({ kind: "new", clientId: step.clientId, cue: step.cue });
      continue;
    }
    const task = tasks.get(step.choreId);
    if (!task || !task.linkable || task.sourceToken !== step.sourceToken)
      return fail("TASK_UNAVAILABLE");
    if (
      task.attachedEventId !== null &&
      task.attachedEventId !== context.event.id
    )
      return fail("ALREADY_LINKED");
    if (!task.subject) return fail("SUBJECT_UNAVAILABLE");
    subject(task.subject);
    if (!day.safeParse(task.dueDay).success) return fail("TASK_UNAVAILABLE");
    const due = step.retimeTo ?? task.dueDay;
    if (step.retimeTo !== null && step.retimeTo !== task.dueDay) {
      if (!task.dateEditable || ["completed", "verified"].includes(task.status))
        return fail("DATE_LOCKED");
      retime.push({
        choreId: task.id,
        sourceToken: task.sourceToken,
        from: task.dueDay,
        to: step.retimeTo,
      });
    }
    if (
      step.cue &&
      preparationDueDay(context.event, step.cue, command.timeZone) !== due
    )
      return fail("CUE_MISMATCH");
    ordered.push({ kind: "existing", choreId: task.id, cue: step.cue });
  }
  if (command.eventChangeDecision === "keep-dates" && retime.length)
    return fail("INVALID");
  if (command.eventChangeDecision === "retime-selected" && !retime.length)
    return fail("INVALID");
  const retained = new Set(
    ordered
      .filter(
        (step): step is Extract<typeof step, { kind: "existing" }> =>
          step.kind === "existing",
      )
      .map((step) => step.choreId),
  );
  const detach = (context.current?.links ?? [])
    .filter((link) => !retained.has(link.choreId))
    .map((link) => link.choreId);
  const previous = (context.current?.links ?? []).map((link) => ({
    kind: "existing",
    choreId: link.choreId,
    cue: link.cue,
  }));
  return {
    reviewedEventSourceToken: context.event.sourceToken,
    create: created,
    ordered,
    detach,
    retime,
    changed:
      (!!context.current && ordered.length === 0) ||
      created.length > 0 ||
      retime.length > 0 ||
      detach.length > 0 ||
      eventChanged ||
      JSON.stringify(previous) !== JSON.stringify(ordered),
  };
}
/** No availability/attendance inference. Hidden or unavailable tasks and stale
 * event timing cannot produce a whole-event checked/marked-done claim. */
export function preparationProgress(input: {
  statuses: PreparationTask["status"][];
  unavailable: number;
  restricted: boolean;
  capped: boolean;
  eventChanged: boolean;
}) {
  if (
    !Number.isInteger(input.unavailable) ||
    input.unavailable < 0 ||
    input.statuses.length + input.unavailable > EVENT_PREPARATION_MAX_STEPS ||
    input.statuses.some(
      (status) =>
        ![
          "pending",
          "in_progress",
          "overdue",
          "completed",
          "verified",
        ].includes(status),
    )
  )
    return fail("UNAVAILABLE");
  const open = input.statuses.filter(
      (status) => !["completed", "verified"].includes(status),
    ).length,
    waitingCheck = input.statuses.filter(
      (status) => status === "completed",
    ).length,
    checked = input.statuses.filter((status) => status === "verified").length;
  const total = input.statuses.length + input.unavailable;
  const state =
    input.restricted || input.capped || input.unavailable > 0
      ? "unknown"
      : input.eventChanged
        ? "needs-review"
        : total === 0
          ? "not-configured"
          : open > 0
            ? "open"
            : waitingCheck > 0
              ? "marked-done"
              : "checked";
  return {
    total,
    open,
    waitingCheck,
    checked,
    unavailable: input.unavailable,
    state,
  };
}
