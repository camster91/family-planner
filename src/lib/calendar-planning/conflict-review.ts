/** Provider-free planning only. All snapshot authority must be rebuilt by the
 * server from canonical records. Tokens/canMove supplied by a browser confer
 * no permission. No calendar mutation or availability claim occurs here. */
import { z } from "zod";
import { parseCalendarInstant, CALENDAR_RANGE_MAX_MS } from "./range";
import { isValidTimeZone } from "@/lib/calendar-import/timezone";
import { memberIdentityIdSchema as id } from "@/lib/member-subject-contract";
export const SCHEDULE_REVIEW_PROTOCOL = "herewoven.schedule-review.v1" as const;
const token = z.string().regex(/^[a-f0-9]{64}$/);
const instant = z.string().refine((value) => {
  try {
    parseCalendarInstant(value);
    return true;
  } catch {
    return false;
  }
});
const interval = z
  .object({ start: instant, end: instant })
  .strict()
  .refine(
    (value) => Date.parse(value.end) > Date.parse(value.start),
    "Positive interval required",
  );
const owner = z.object({ userId: id, familyId: id }).strict();
export const scheduleBuffers = z
  .object({
    preparation: z.number().int().min(0).max(240),
    travelBefore: z.number().int().min(0).max(240),
    travelAfter: z.number().int().min(0).max(240),
  })
  .strict();
export type ScheduleBuffers = z.infer<typeof scheduleBuffers>;
export const NO_SCHEDULE_BUFFERS: Readonly<ScheduleBuffers> = Object.freeze({
  preparation: 0,
  travelBefore: 0,
  travelAfter: 0,
});
export const scheduleReviewEvent = z
  .object({
    id,
    title: z.string().max(480),
    start: instant,
    end: instant,
    sourceToken: token,
    origin: z.enum(["local", "connected", "subscribed"]),
    repeating: z.boolean(),
    canMove: z.boolean(),
  })
  .strict()
  .refine(
    (value) => Date.parse(value.end) > Date.parse(value.start),
    "Positive event duration required",
  );
export type ScheduleReviewEvent = z.infer<typeof scheduleReviewEvent>;
export const scheduleReviewSnapshot = z
  .object({
    protocol: z.literal(SCHEDULE_REVIEW_PROTOCOL),
    owner,
    role: z.enum(["parent", "teen", "child"]),
    timeZone: z.string().max(100).refine(isValidTimeZone),
    range: interval,
    // Generated only by a fresh authorized canonical read; binds the whole range
    // and all compared sources, including event generation/material epochs.
    snapshotToken: token,
    coverage: z
      .object({
        complete: z.boolean(),
        recurrence: z.enum(["complete", "stored-only"]),
        sourcesUnavailable: z.boolean(),
        capped: z.boolean(),
      })
      .strict(),
    events: z.array(scheduleReviewEvent).max(500),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      Date.parse(value.range.end) - Date.parse(value.range.start) >
        CALENDAR_RANGE_MAX_MS ||
      new Set(value.events.map((event) => event.id)).size !==
        value.events.length
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid or duplicate snapshot scope",
      });
  });
export type ScheduleReviewSnapshot = z.infer<typeof scheduleReviewSnapshot>;
const scheduleReviewQueryObject = z
  .object({
    protocol: z.literal(SCHEDULE_REVIEW_PROTOCOL),
    owner,
    range: interval,
    timeZone: z.string().max(100).refine(isValidTimeZone),
    snapshotToken: token,
    target: z.object({ id, sourceToken: token }).strict(),
    buffers: scheduleBuffers,
    otherBuffers: z
      .array(
        z.object({ id, sourceToken: token, buffers: scheduleBuffers }).strict(),
      )
      .max(100),
    windows: z.array(interval).min(1).max(16),
    gridMinutes: z.union([
      z.literal(5),
      z.literal(10),
      z.literal(15),
      z.literal(30),
      z.literal(60),
    ]),
  })
  .strict();
export const scheduleReviewQuery = scheduleReviewQueryObject.refine(
  (value) =>
    new Set(value.otherBuffers.map((row) => row.id)).size ===
    value.otherBuffers.length,
  "Duplicate buffer override",
);
export type ScheduleReviewQuery = z.infer<typeof scheduleReviewQuery>;
export class ScheduleReviewError extends Error {
  constructor(
    public readonly code:
      | "INVALID"
      | "OWNER_CHANGED"
      | "STALE"
      | "MISSING"
      | "INVALID_WINDOW"
      | "UNAVAILABLE"
      | "FORBIDDEN"
      | "UNAUTHORIZED"
      | "EXPIRED"
      | "UNSUPPORTED",
  ) {
    super("Schedule review needs a fresh authorized snapshot");
  }
}
type Span = { start: number; end: number };
function merge(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end);
  const result: Span[] = [];
  for (const span of sorted) {
    const last = result.at(-1);
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else result.push({ ...span });
  }
  return result;
}
const ms = (minutes: number) => minutes * 60000;
const before = (buffers: ScheduleBuffers) =>
  ms(buffers.preparation + buffers.travelBefore);
const after = (buffers: ScheduleBuffers) => ms(buffers.travelAfter);
const iso = (value: number) => new Date(value).toISOString();
function expanded(event: ScheduleReviewEvent, buffers: ScheduleBuffers): Span {
  return {
    start: Date.parse(event.start) - before(buffers),
    end: Date.parse(event.end) + after(buffers),
  };
}
const intersects = (a: Span, b: Span) => a.start < b.end && b.start < a.end;
export type ScheduleReviewPlan = {
  protocol: typeof SCHEDULE_REVIEW_PROTOCOL;
  owner: ScheduleReviewSnapshot["owner"];
  snapshotToken: string;
  target: ScheduleReviewEvent;
  buffers: ScheduleBuffers;
  conflictCount: number;
  conflicts: {
    event: ScheduleReviewEvent;
    reason: "event-overlap" | "buffer-overlap";
    start: string;
    end: string;
  }[];
  moreConflicts: boolean;
  alternatives: {
    start: string;
    end: string;
    reservedStart: string;
    reservedEnd: string;
    provisional: boolean;
  }[];
  holds: (
    | "read-only"
    | "repeating-target"
    | "incomplete"
    | "recurrence-unknown"
    | "sources-unavailable"
    | "capped"
    | "no-opening"
  )[];
  canApply: boolean;
};
/** Half-open intervals: touching is not a collision. No person/attendance claim.
 * Gap candidates use endpoints and the nearest grid point; never scan each
 * minute or silently extend the user's requested windows. now is caller-owned. */
export function planScheduleReview(
  rawSnapshot: unknown,
  rawQuery: unknown,
  now: Date,
): ScheduleReviewPlan {
  const snapshotResult = scheduleReviewSnapshot.safeParse(rawSnapshot),
    queryResult = scheduleReviewQuery.safeParse(rawQuery);
  if (
    !snapshotResult.success ||
    !queryResult.success ||
    !Number.isFinite(now.getTime())
  )
    throw new ScheduleReviewError("INVALID");
  const snapshot = snapshotResult.data,
    query = queryResult.data;
  if (
    snapshot.owner.userId !== query.owner.userId ||
    snapshot.owner.familyId !== query.owner.familyId
  )
    throw new ScheduleReviewError("OWNER_CHANGED");
  if (snapshot.snapshotToken !== query.snapshotToken)
    throw new ScheduleReviewError("STALE");
  if (
    snapshot.timeZone !== query.timeZone ||
    Date.parse(snapshot.range.start) !== Date.parse(query.range.start) ||
    Date.parse(snapshot.range.end) !== Date.parse(query.range.end)
  )
    throw new ScheduleReviewError("STALE");
  const events = new Map(snapshot.events.map((event) => [event.id, event]));
  const target = events.get(query.target.id);
  if (!target) throw new ScheduleReviewError("MISSING");
  if (target.sourceToken !== query.target.sourceToken)
    throw new ScheduleReviewError("STALE");
  const overrides = new Map<string, ScheduleBuffers>();
  for (const row of query.otherBuffers) {
    const event = events.get(row.id);
    if (!event || row.id === target.id)
      throw new ScheduleReviewError("MISSING");
    if (event.sourceToken !== row.sourceToken)
      throw new ScheduleReviewError("STALE");
    overrides.set(row.id, row.buffers);
  }
  const range = {
    start: Date.parse(snapshot.range.start),
    end: Date.parse(snapshot.range.end),
  };
  const windows = merge(
    query.windows.map((window) => {
      const span = {
        start: Date.parse(window.start),
        end: Date.parse(window.end),
      };
      if (span.start < range.start || span.end > range.end)
        throw new ScheduleReviewError("INVALID_WINDOW");
      return span;
    }),
  );
  const occupied = snapshot.events
    .filter((event) => event.id !== target.id)
    .map((event) => ({
      event,
      span: expanded(event, overrides.get(event.id) ?? NO_SCHEDULE_BUFFERS),
    }));
  const reserved = expanded(target, query.buffers);
  const actual = {
    start: Date.parse(target.start),
    end: Date.parse(target.end),
  };
  const allConflicts = occupied.filter((row) => intersects(reserved, row.span));
  const conflicts = allConflicts
    .slice()
    .sort(
      (a, b) =>
        a.span.start - b.span.start || a.event.id.localeCompare(b.event.id),
    )
    .slice(0, 8)
    .map((row) => ({
      event: row.event,
      reason: intersects(actual, {
        start: Date.parse(row.event.start),
        end: Date.parse(row.event.end),
      })
        ? ("event-overlap" as const)
        : ("buffer-overlap" as const),
      start: iso(Math.max(reserved.start, row.span.start)),
      end: iso(Math.min(reserved.end, row.span.end)),
    }));
  const duration = actual.end - actual.start,
    lead = before(query.buffers),
    tail = after(query.buffers),
    grid = ms(query.gridMinutes);
  const busy = merge(occupied.map((row) => row.span));
  const choices = new Set<number>();
  function gap(span: Span) {
    const lower =
      Math.ceil((Math.max(span.start, now.getTime()) + lead) / grid) * grid;
    const upper = Math.floor((span.end - duration - tail) / grid) * grid;
    if (upper < lower) return;
    const near = Math.max(
      lower,
      Math.min(upper, Math.round(actual.start / grid) * grid),
    );
    for (const start of [near, near - grid, near + grid, lower, upper])
      if (start >= lower && start <= upper && start !== actual.start)
        choices.add(start);
  }
  for (const window of windows) {
    let cursor = window.start;
    for (const span of busy) {
      if (span.end <= cursor) continue;
      if (span.start >= window.end) break;
      if (span.start > cursor)
        gap({ start: cursor, end: Math.min(window.end, span.start) });
      cursor = Math.max(cursor, span.end);
      if (cursor >= window.end) break;
    }
    if (cursor < window.end) gap({ start: cursor, end: window.end });
  }
  const holds: ScheduleReviewPlan["holds"] = [];
  if (
    snapshot.role !== "parent" ||
    !target.canMove ||
    target.origin === "subscribed"
  )
    holds.push("read-only");
  if (target.repeating) holds.push("repeating-target");
  if (
    !snapshot.coverage.complete ||
    reserved.start < range.start ||
    reserved.end > range.end
  )
    holds.push("incomplete");
  if (snapshot.coverage.recurrence !== "complete")
    holds.push("recurrence-unknown");
  if (snapshot.coverage.sourcesUnavailable) holds.push("sources-unavailable");
  if (snapshot.coverage.capped) holds.push("capped");
  const provisional = holds.some(
    (value) => !["read-only", "repeating-target"].includes(value),
  );
  const alternatives = [...choices]
    .sort(
      (a, b) =>
        Math.abs(a - actual.start) - Math.abs(b - actual.start) || a - b,
    )
    .slice(0, 3)
    .map((start) => ({
      start: iso(start),
      end: iso(start + duration),
      reservedStart: iso(start - lead),
      reservedEnd: iso(start + duration + tail),
      provisional,
    }));
  if (alternatives.length === 0) holds.push("no-opening");
  return {
    protocol: SCHEDULE_REVIEW_PROTOCOL,
    owner: snapshot.owner,
    snapshotToken: snapshot.snapshotToken,
    target,
    buffers: query.buffers,
    conflictCount: allConflicts.length,
    conflicts,
    moreConflicts: allConflicts.length > conflicts.length,
    alternatives,
    holds,
    canApply: holds.length === 0,
  };
}
/** Explicit preview intent only. A canonical atomic server writer must rebuild
 * the snapshot, authorize and recompute this candidate before any real effect. */
export const scheduleMoveCommand = scheduleReviewQueryObject
  .extend({
    action: z.literal("reschedule"),
    start: instant,
    end: instant,
    issuedAt: instant,
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.otherBuffers.map((row) => row.id)).size ===
        value.otherBuffers.length &&
      Date.parse(value.end) > Date.parse(value.start),
    "Invalid move intent",
  );
export type ScheduleMoveCommand = z.infer<typeof scheduleMoveCommand>;
export function previewScheduleMove(
  snapshot: unknown,
  query: unknown,
  choice: { start: string; end: string },
  now: Date,
): ScheduleMoveCommand {
  const plan = planScheduleReview(snapshot, query, now);
  if (
    !plan.canApply ||
    !plan.alternatives.some(
      (candidate) =>
        candidate.start === choice.start && candidate.end === choice.end,
    )
  )
    throw new ScheduleReviewError("STALE");
  return scheduleMoveCommand.parse({
    ...scheduleReviewQuery.parse(query),
    action: "reschedule",
    start: choice.start,
    end: choice.end,
    issuedAt: now.toISOString(),
  });
}

/** Shared read scope. A fingerprint cannot reconstruct or authorize a range. */
export const scheduleReviewScope = z
  .object({
    targetId: id,
    range: interval,
    timeZone: z.string().max(100).refine(isValidTimeZone),
  })
  .strict();
export type ScheduleReviewScope = z.infer<typeof scheduleReviewScope>;
export const scheduleReviewInstant = instant;
export function requireScheduleIntentAge(
  command: ScheduleMoveCommand,
  now: Date,
) {
  const age = now.getTime() - Date.parse(command.issuedAt);
  if (!Number.isFinite(age) || age < -60000 || age > 15 * 60000)
    throw new ScheduleReviewError("EXPIRED");
}
