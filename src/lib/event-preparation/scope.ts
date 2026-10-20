/** Server-only reviewed-scope fingerprint. This is a stale-write guard, never
 * authentication, a signed capability or a substitute for canonical row locks. */
import { parseCalendarInstant } from "@/lib/calendar-planning/range";
import { createHash } from "node:crypto";
import { z } from "zod";
import { memberIdentityIdSchema as id } from "@/lib/member-subject-contract";
import { responsibilitySubject } from "@/lib/responsibility";
import { isValidTimeZone } from "@/lib/calendar-import/timezone";
import { parseDateOnly } from "@/lib/dates";
import {
  EVENT_PREPARATION_PROTOCOL,
  EVENT_PREPARATION_MAX_STEPS,
  EventPreparationError,
  preparationCue,
  type PreparationContext,
} from "./contract";
const token = z.string().regex(/^[a-f0-9]{64}$/);
// Saturated versions hold new edits; canonical cleanup remains possible.
const epoch = z.number().int().min(0).max(2147483646);
const day = z.string().refine((value) => parseDateOnly(value) !== null);
const metadata = z
  .object({
    eventGeneration: z.string().uuid(),
    eventEpoch: epoch,
    preparationEpoch: epoch,
    plan: z.object({ id, revision: epoch }).strict().nullable(),
  })
  .strict();
export type PreparationScopeMetadata = z.infer<typeof metadata>;
const task = z
  .object({
    id,
    sourceToken: token,
    dueDay: day,
    subject: responsibilitySubject.nullable(),
    status: z.enum([
      "pending",
      "in_progress",
      "overdue",
      "completed",
      "verified",
    ]),
    attachedEventId: id.nullable(),
    linkable: z.boolean(),
    dateEditable: z.boolean(),
  })
  .strict();
const current = z
  .object({
    reviewedEventSourceToken: token,
    links: z
      .array(z.object({ choreId: id, cue: preparationCue.nullable() }).strict())
      .max(EVENT_PREPARATION_MAX_STEPS),
  })
  .strict()
  .nullable();
/** Context must be freshly reconstructed by the authorized server with related
 * identities and source stacks locked before sorted Chores, then Event/plan.
 * Task tokens include canonical content/identity/source versions. Routine token
 * includes its complete dated occurrence and selected source-step versions.
 * Never accept context or metadata from a request as authority. */
export function preparationScopeToken(
  context: Omit<PreparationContext, "viewToken">,
  rawMetadata: PreparationScopeMetadata,
): string {
  try {
    if (
      +parseCalendarInstant(context.event.end) <
      +parseCalendarInstant(context.event.start)
    )
      throw new Error("Invalid event interval");
  } catch {
    throw new EventPreparationError("UNAVAILABLE");
  }
  const parsed = metadata.safeParse(rawMetadata);
  const linked = current.safeParse(context.current);
  const tasks = z.array(task).max(500).safeParse(context.tasks);
  const subjects = z
    .array(responsibilitySubject)
    .max(500)
    .safeParse(context.eligibleSubjects);
  if (
    !parsed.success ||
    !linked.success ||
    !tasks.success ||
    !subjects.success ||
    context.actor.kind !== "person" ||
    context.actor.role !== "parent" ||
    !id.safeParse(context.actor.userId).success ||
    !id.safeParse(context.actor.familyId).success ||
    ![1, 2].includes(context.actor.memberProtocol) ||
    context.event.familyId !== context.actor.familyId ||
    !id.safeParse(context.event.id).success ||
    !token.safeParse(context.event.sourceToken).success ||
    !isValidTimeZone(context.timeZone) ||
    Boolean(parsed.data.plan) !== Boolean(linked.data)
  )
    throw new EventPreparationError("UNAVAILABLE");
  const taskRows = [...tasks.data].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  const subjectRows = subjects.data
    .map((subject) =>
      subject.kind === "account"
        ? ["account", subject.accountId]
        : ["profile", subject.memberId],
    )
    .sort((a, b) =>
      JSON.stringify(a) < JSON.stringify(b)
        ? -1
        : JSON.stringify(a) > JSON.stringify(b)
          ? 1
          : 0,
    );
  if (
    new Set(taskRows.map((row) => row.id)).size !== taskRows.length ||
    new Set(subjectRows.map((row) => JSON.stringify(row))).size !==
      subjectRows.length ||
    (linked.data &&
      new Set(linked.data.links.map((row) => row.choreId)).size !==
        linked.data.links.length)
  )
    throw new EventPreparationError("UNAVAILABLE");
  const routine = context.routine;
  if (
    routine &&
    (!id.safeParse(routine.id).success ||
      !token.safeParse(routine.sourceToken).success ||
      !day.safeParse(routine.occurrenceDay).success ||
      routine.steps.length > EVENT_PREPARATION_MAX_STEPS ||
      new Set(routine.steps.map((row) => row.id)).size !==
        routine.steps.length ||
      routine.steps.some(
        (row) =>
          !id.safeParse(row.id).success ||
          !token.safeParse(row.sourceToken).success,
      ))
  )
    throw new EventPreparationError("UNAVAILABLE");
  // Fixed tuples avoid object property insertion order and locale/content hash
  // instability. Link order and routine step order are meaningful; directory
  // and task query order are not. No private text is returned in the digest.
  return createHash("sha256")
    .update(
      JSON.stringify([
        EVENT_PREPARATION_PROTOCOL,
        "reviewed-scope",
        context.actor.userId,
        context.actor.familyId,
        context.actor.role,
        context.actor.memberProtocol,
        context.timeZone,
        context.writesEnabled,
        context.pointsEnabled,
        context.profileWritesEnabled,
        context.complete,
        [
          context.event.id,
          context.event.sourceToken,
          context.event.start,
          context.event.end,
          context.event.active,
        ],
        [
          parsed.data.eventGeneration,
          parsed.data.eventEpoch,
          parsed.data.preparationEpoch,
          parsed.data.plan
            ? [parsed.data.plan.id, parsed.data.plan.revision]
            : null,
        ],
        linked.data
          ? [
              linked.data.reviewedEventSourceToken,
              linked.data.links.map((row) => [
                row.choreId,
                row.cue
                  ? [row.cue.anchor, row.cue.direction, row.cue.minutes]
                  : null,
              ]),
            ]
          : null,
        taskRows.map((row) => [
          row.id,
          row.sourceToken,
          row.dueDay,
          row.subject?.kind === "account"
            ? ["account", row.subject.accountId]
            : row.subject
              ? ["profile", row.subject.memberId]
              : null,
          row.status,
          row.attachedEventId,
          row.linkable,
          row.dateEditable,
        ]),
        subjectRows,
        routine
          ? [
              routine.id,
              routine.sourceToken,
              routine.occurrenceDay,
              routine.complete,
              routine.steps.map((row) => [
                row.id,
                row.sourceToken,
                row.copyable,
              ]),
            ]
          : null,
      ]),
    )
    .digest("hex");
}
