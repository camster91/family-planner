/** Internal canonical source/version primitives, never independent authority.
 * A caller must authenticate, lock actor/household, renew membership/role/token
 * and features, then lock the selected Event before reading comparison inputs.
 * All source/identity locks must precede that Event. Blockers remain plain MVCC
 * reads; no new shared lock is added to ordinary legacy calendar writers. */
import {
  scheduleStatusQuery,
  scheduleSourceStatus,
  type ScheduleSourceStatus,
} from "./schedule-status";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { memberIdentityIdSchema as id } from "@/lib/member-subject-contract";
import { parseCalendarInstant, CALENDAR_RANGE_MAX_MS } from "./range";
import {
  SCHEDULE_REVIEW_PROTOCOL,
  ScheduleReviewError,
  type ScheduleReviewSnapshot,
  type ScheduleReviewEvent,
} from "./conflict-review";
type Reader = Pick<Prisma.TransactionClient, "$queryRaw">;
const epoch = z.number().int().min(0).max(2147483646);
const generation = z.string().uuid();
const source = z.object({ id, generation, epoch }).strict();
export type ScheduleEventSource = z.infer<typeof source>;
export async function scheduleStorageAvailable(tx: Reader) {
  const rows = await tx.$queryRaw<Array<{ ready: boolean }>>`
    SELECT (SELECT COUNT(*) = 2 FROM pg_attribute WHERE NOT attisdropped AND attnotnull
       AND attrelid = to_regclass('public."Event"')
       AND attname IN ('schedule_generation', 'schedule_epoch')) AND EXISTS (
         SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass('public."Event"')
           AND tgname = 'herewoven_schedule_event_epoch' AND NOT tgisinternal
           AND tgenabled IN ('O', 'A') AND tgtype = 19
           AND tgfoid = to_regprocedure('public.herewoven_schedule_event_epoch()')
       ) AS ready`;
  return rows[0]?.ready === true;
}
export function scheduleEventToken(
  familyId: string,
  raw: ScheduleEventSource,
): string {
  // Database readers also carry times and source metadata. Validate the exact
  // version projection; those extra canonical fields are not token inputs.
  const value = source.safeParse({
    id: raw?.id,
    generation: raw?.generation,
    epoch: raw?.epoch,
  });
  if (!value.success || !id.safeParse(familyId).success)
    throw new ScheduleReviewError("UNAVAILABLE");
  return createHash("sha256")
    .update(
      JSON.stringify([
        SCHEDULE_REVIEW_PROTOCOL,
        "event",
        familyId,
        value.data.id,
        value.data.generation,
        value.data.epoch,
      ]),
    )
    .digest("hex");
}
export async function lockScheduleTarget(
  tx: Reader,
  familyId: string,
  eventId: string,
) {
  id.parse(familyId);
  id.parse(eventId);
  if (!(await scheduleStorageAvailable(tx)))
    throw new ScheduleReviewError("UNAVAILABLE");
  const rows = await tx.$queryRaw<
    Array<{ id: string; generation: string; epoch: number }>
  >`
    SELECT "id", "schedule_generation" AS generation, "schedule_epoch" AS epoch
    FROM "Event" WHERE "id" = ${eventId} AND "family_id" = ${familyId} FOR UPDATE`;
  const row = rows[0];
  if (!row) throw new ScheduleReviewError("MISSING");
  return { ...row, sourceToken: scheduleEventToken(familyId, row) };
}
/** Same predicate must be used by the snapshot loader and the atomic writer.
 * Every source is compared. All stored repeating roots remain visible as
 * uncertainty even when their first occurrence is outside the chosen range.
 * Padding covers the largest allowed buffers (480 before, 240 after). */
export function scheduleComparisonPredicate(
  familyId: string,
  targetId: string | null,
  range: ScheduleReviewSnapshot["range"],
) {
  id.parse(familyId);
  if (targetId !== null) id.parse(targetId);
  const start = parseCalendarInstant(range.start),
    end = parseCalendarInstant(range.end);
  if (+end <= +start || +end - +start > CALENDAR_RANGE_MAX_MS)
    throw new ScheduleReviewError("INVALID_WINDOW");
  const paddedStart = new Date(+start - 240 * 60000),
    paddedEnd = new Date(+end + 480 * 60000);
  if (paddedStart.getUTCFullYear() < 1 || paddedEnd.getUTCFullYear() > 9999)
    throw new ScheduleReviewError("INVALID_WINDOW");
  const target =
    targetId === null ? Prisma.sql`false` : Prisma.sql`"id" = ${targetId}`;
  return Prisma.sql`"family_id" = ${familyId} AND (${target} OR "recurrence" IS NOT NULL OR "end_time" <= "start_time" OR
    ("start_time" < (${paddedEnd.toISOString()}::timestamptz AT TIME ZONE 'UTC') AND "end_time" > (${paddedStart.toISOString()}::timestamptz AT TIME ZONE 'UTC')))`;
}
export type ScheduleComparisonRow = ScheduleEventSource & {
  title: string;
  start: Date;
  end: Date;
  recurrence: string | null;
  sourceSubscriptionId: string | null;
  sourceConnectionId: string | null;
};
/** One statement supplies content and versions from the same snapshot. 501
 * signals a cap; it is never silently promoted to a complete 500-row result.
 * Invalid legacy intervals and unexpanded recurring roots stay explicit inputs,
 * not silently absent/free time. No provider refresh occurs in this read. */
export async function readScheduleComparisonInTx(
  tx: Reader,
  familyId: string,
  targetId: string,
  range: ScheduleReviewSnapshot["range"],
) {
  if (!(await scheduleStorageAvailable(tx)))
    throw new ScheduleReviewError("UNAVAILABLE");
  const predicate = scheduleComparisonPredicate(familyId, targetId, range);
  return tx.$queryRaw<ScheduleComparisonRow[]>(Prisma.sql`
    SELECT "id", "schedule_generation" AS generation, "schedule_epoch" AS epoch,
      "title", "start_time" AS start, "end_time" AS end, "recurrence",
      "source_subscription_id" AS "sourceSubscriptionId", "source_connection_id" AS "sourceConnectionId"
    FROM "Event" WHERE ${predicate} ORDER BY ("id" = ${targetId}) DESC, "id" LIMIT 501`);
}
/** Same range/root/invalid-interval policy as conflict review, without an
 * invented target or unnecessary household event titles. Read-only callers
 * renew actor/household authority before this helper. */
export async function readScheduleIntervalsInTx(
  tx: Reader,
  familyId: string,
  range: ScheduleReviewSnapshot["range"],
) {
  if (!(await scheduleStorageAvailable(tx)))
    throw new ScheduleReviewError("UNAVAILABLE");
  const predicate = scheduleComparisonPredicate(familyId, null, range);
  return tx.$queryRaw<Omit<ScheduleComparisonRow, "title">[]>(Prisma.sql`
    SELECT "id", "schedule_generation" AS generation, "schedule_epoch" AS epoch,
      "start_time" AS start, "end_time" AS end, "recurrence",
      "source_subscription_id" AS "sourceSubscriptionId", "source_connection_id" AS "sourceConnectionId"
    FROM "Event" WHERE ${predicate} ORDER BY "id" LIMIT 501`);
}
/** Fingerprint exact authorized scope and sorted canonical insertion/material
 * versions, not content. A browser cannot turn this metadata into permission. */
export function scheduleSnapshotToken(input: {
  owner: ScheduleReviewSnapshot["owner"];
  role: ScheduleReviewSnapshot["role"];
  tokenVersion: number;
  sourceStatusToken: string;
  timeZone: string;
  range: ScheduleReviewSnapshot["range"];
  coverage: ScheduleReviewSnapshot["coverage"];
  events: Pick<ScheduleReviewEvent, "id" | "sourceToken">[];
}): string {
  if (
    !/^[a-f0-9]{64}$/.test(input.sourceStatusToken) ||
    !Number.isInteger(input.tokenVersion) ||
    input.tokenVersion < 0 ||
    input.events.length > 500 ||
    new Set(input.events.map((event) => event.id)).size !==
      input.events.length ||
    input.events.some(
      (event) =>
        !id.safeParse(event.id).success ||
        !/^[a-f0-9]{64}$/.test(event.sourceToken),
    )
  )
    throw new ScheduleReviewError("UNAVAILABLE");
  const coverage = input.coverage;
  return createHash("sha256")
    .update(
      JSON.stringify([
        SCHEDULE_REVIEW_PROTOCOL,
        "snapshot",
        input.owner.userId,
        input.owner.familyId,
        input.role,
        input.tokenVersion,
        input.sourceStatusToken,
        input.timeZone,
        input.range.start,
        input.range.end,
        coverage.complete,
        coverage.recurrence,
        coverage.sourcesUnavailable,
        coverage.capped,
        input.events
          .map((event) => [event.id, event.sourceToken])
          .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
      ]),
    )
    .digest("hex");
}
/** Final comparison AND canonical time update share one PostgreSQL statement
 * snapshot after the caller has locked the selected target. Inserts/deletes,
 * changed-away/back sources and recreated IDs before that snapshot cannot hide
 * behind an earlier list read. No blocker rows or collection metadata are
 * locked, avoiding the Event->collection->another Event inversion for legacy
 * multi-row writers. A later independent calendar change can still introduce
 * another conflict; this does not promise permanent availability.
 *
 * This is only the internal effect primitive. Caller MUST first rebuild the
 * authorized complete plan and chosen candidate, enforce write readiness and
 * original age/body/owner, and commit the minimal idempotency receipt in this
 * SAME transaction. Never call it as a standalone API or without actor/HH/
 * current Family and selected Event locks. Paired devices/profiles do not act.
 * A zero result is a conflict, never success or permission to retry a new body.
 */
export async function applyComparedScheduleMoveInTx(
  tx: Reader,
  input: {
    familyId: string;
    targetId: string;
    range: ScheduleReviewSnapshot["range"];
    compared: ScheduleEventSource[];
    sourceStatuses: ScheduleSourceStatus[];
    start: string;
    end: string;
  },
) {
  const parsed = z.array(source).min(1).max(500).safeParse(input.compared);
  if (
    !parsed.success ||
    new Set(parsed.data.map((row) => row.id)).size !== parsed.data.length ||
    !parsed.data.some((row) => row.id === input.targetId)
  )
    throw new ScheduleReviewError("INVALID");
  const targetSource = parsed.data.find((row) => row.id === input.targetId)!;
  const statuses = z
    .array(scheduleSourceStatus)
    .max(100)
    .safeParse(input.sourceStatuses);
  if (
    !statuses.success ||
    new Set(statuses.data.map((row) => `${row.kind}:${row.id}`)).size !==
      statuses.data.length
  )
    throw new ScheduleReviewError("INVALID");
  const start = parseCalendarInstant(input.start),
    end = parseCalendarInstant(input.end);
  if (+end <= +start) throw new ScheduleReviewError("INVALID_WINDOW");
  const predicate = scheduleComparisonPredicate(
    input.familyId,
    input.targetId,
    input.range,
  );
  const rows = await tx.$queryRaw<
    Array<{
      id: string;
      generation: string;
      epoch: number;
      start: Date;
      end: Date;
    }>
  >(Prisma.sql`
    WITH new_times AS (
      SELECT (${start.toISOString()}::timestamptz AT TIME ZONE 'UTC') AS start_utc, (${end.toISOString()}::timestamptz AT TIME ZONE 'UTC') AS end_utc
    ), current_sources AS MATERIALIZED (
      SELECT "id", "schedule_generation" AS generation, "schedule_epoch" AS epoch
      FROM "Event" WHERE ${predicate} ORDER BY "id" LIMIT 501
    ), expected_sources AS MATERIALIZED (
      SELECT * FROM jsonb_to_recordset(${JSON.stringify(parsed.data)}::jsonb) AS source(id text, generation text, epoch integer)
    ), current_statuses AS MATERIALIZED (${scheduleStatusQuery(input.familyId)}), expected_statuses AS MATERIALIZED (
      SELECT * FROM jsonb_to_recordset(${JSON.stringify(statuses.data)}::jsonb) AS source(kind text, id text, status text, "checkedAt" timestamptz, "updatedAt" timestamptz, generation integer)
    ), unchanged AS (
      SELECT NOT EXISTS (
        SELECT 1 FROM current_sources AS current FULL JOIN expected_sources AS expected ON current.id = expected.id
        WHERE current.id IS NULL OR expected.id IS NULL OR current.generation IS DISTINCT FROM expected.generation OR current.epoch IS DISTINCT FROM expected.epoch
      ) AND NOT EXISTS (
        SELECT 1 FROM current_statuses AS current FULL JOIN expected_statuses AS expected ON current.kind = expected.kind AND current.id = expected.id
        WHERE current.id IS NULL OR expected.id IS NULL OR current.status IS DISTINCT FROM expected.status OR current.generation IS DISTINCT FROM expected.generation
          OR current."checkedAt" IS DISTINCT FROM (expected."checkedAt" AT TIME ZONE 'UTC') OR current."updatedAt" IS DISTINCT FROM (expected."updatedAt" AT TIME ZONE 'UTC')
      ) AS matches
    )
    UPDATE "Event" AS target SET "start_time" = new_times.start_utc, "end_time" = new_times.end_utc, "updated_at" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
    FROM new_times WHERE target."id" = ${input.targetId} AND target."family_id" = ${input.familyId}
      AND target."schedule_generation" = ${targetSource.generation} AND target."schedule_epoch" = ${targetSource.epoch}
      AND target."source_subscription_id" IS NULL AND target."recurrence" IS NULL
      AND (new_times.end_utc - new_times.start_utc) = (target."end_time" - target."start_time")
      AND (SELECT matches FROM unchanged)
    RETURNING target."id", target."schedule_generation" AS generation, target."schedule_epoch" AS epoch, target."start_time" AS start, target."end_time" AS end`);
  if (rows.length !== 1) throw new ScheduleReviewError("STALE");
  const result = z
    .object({
      id,
      generation,
      epoch: z.number().int().min(0).max(2147483647),
      start: z.date(),
      end: z.date(),
    })
    .strict()
    .safeParse(rows[0]);
  if (
    !result.success ||
    result.data.id !== input.targetId ||
    +result.data.start !== +start ||
    +result.data.end !== +end
  )
    throw new ScheduleReviewError("UNAVAILABLE");
  return result.data;
}
