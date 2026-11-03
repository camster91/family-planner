/** Native bounded comparison with atomic read witnesses. No provider refresh or
 * guessed availability: recurrence, stale sources and capped ranges stay unknown.
 */
import type { D1ReadClient, NativeD1 } from "./read-client";
import { captureD1Reads } from "./read-witness";
import { isFeatureEnabled, normalizeFeatures } from "../features";
import {
  ScheduleReviewError,
  scheduleReviewScope,
  planScheduleReview,
  type ScheduleReviewQuery,
  type ScheduleReviewScope,
} from "../calendar-planning/conflict-review";
import {
  buildScheduleSnapshot,
  requireScheduleOwner,
  scopeForScheduleCommand,
  type ScheduleActor,
} from "../calendar-planning/schedule-runtime";
import { scheduleSourceStatus } from "../calendar-planning/schedule-status";
import type { ScheduleComparisonRow } from "../calendar-planning/schedule-source";
import {
  getD1Database,
  type D1Store,
  type SqlValue,
  type D1Statement,
} from "./database";
import { d1WriteCheck, isD1WriteConflict } from "./write-check";

type Comparison = {
  id: string;
  title: string;
  start: number;
  end: number;
  generation: string;
  epoch: number;
  recurrence: string | null;
  sourceSubscriptionId: string | null;
  sourceConnectionId: string | null;
};
const eventColumns = [
  "id",
  "title",
  "start",
  "end",
  "generation",
  "epoch",
  "recurrence",
  "sourceSubscriptionId",
  "sourceConnectionId",
];
const statusColumns = [
  "kind",
  "id",
  "status",
  "checkedAt",
  "updatedAt",
  "generation",
];
export async function d1ScheduleStorageAvailable(db?: D1Store) {
  const row = await (db ?? (await getD1Database()))
    .prepare(
      `SELECT COUNT(*) AS count FROM sqlite_master WHERE type='trigger' AND tbl_name='Event' AND name IN ('Event_schedule_identity_guard','Event_schedule_epoch_insert','Event_schedule_material_epoch')`,
    )
    .first<{ count: number }>();
  return row?.count === 3;
}
export async function captureD1ScheduleSource(
  actor: ScheduleActor,
  rawScope: ScheduleReviewScope,
  database?: D1Store,
  now = new Date(),
) {
  const db = database ?? (await getD1Database()),
    session = db.withSession("first-primary");
  if (!(await d1ScheduleStorageAvailable(db)))
    throw new ScheduleReviewError("UNAVAILABLE");
  const parsed = scheduleReviewScope.parse(rawScope);
  const scope = {
    ...parsed,
    range: {
      start: new Date(parsed.range.start).toISOString(),
      end: new Date(parsed.range.end).toISOString(),
    },
  };
  const first = Date.parse(scope.range.start) - 240 * 60000,
    last = Date.parse(scope.range.end) + 480 * 60000;
  if (
    new Date(first).getUTCFullYear() < 1 ||
    new Date(last).getUTCFullYear() > 9999
  )
    throw new ScheduleReviewError("INVALID_WINDOW");
  const observed: Array<{
    sql: string;
    values: SqlValue[];
    columns: string[];
    rows: unknown[][];
  }> = [];
  async function read<T>(
    sql: string,
    values: SqlValue[],
    columns: string[],
  ): Promise<T[]> {
    const result = await session
      .prepare(sql)
      .bind(...values)
      .all<Record<string, SqlValue>>();
    observed.push({
      sql,
      values,
      columns,
      rows: result.results.map((row) => columns.map((column) => row[column])),
    });
    return result.results as T[];
  }
  const users = await read<{
    family_id: string | null;
    role: string;
    token_version: number;
    features: string | null;
  }>(
    `SELECT u.family_id,u.role,u.token_version,f.features FROM User u LEFT JOIN Family f ON f.id=u.family_id WHERE u.id=?`,
    [actor.userId],
    ["family_id", "role", "token_version", "features"],
  );
  const user = users[0];
  if (!user || user.token_version !== actor.tokenVersion)
    throw new ScheduleReviewError("UNAUTHORIZED");
  if (
    user.family_id !== actor.familyId ||
    !["parent", "teen", "child"].includes(user.role)
  )
    throw new ScheduleReviewError("FORBIDDEN");
  let features: unknown = null;
  try {
    features =
      typeof user.features === "string"
        ? JSON.parse(user.features)
        : user.features;
  } catch {
    throw new ScheduleReviewError("UNAVAILABLE");
  }
  if (!isFeatureEnabled(normalizeFeatures(features), "calendar"))
    throw new ScheduleReviewError("FORBIDDEN");
  const events = await read<Comparison>(
    `SELECT id,title,start_time AS start,end_time AS end,schedule_generation AS generation,schedule_epoch AS epoch,recurrence,source_subscription_id AS sourceSubscriptionId,source_connection_id AS sourceConnectionId FROM Event WHERE family_id=?1 AND (id=?2 OR recurrence IS NOT NULL OR end_time<=start_time OR (start_time<?3 AND end_time>?4)) ORDER BY (id=?2) DESC,id LIMIT 501`,
    [actor.familyId, scope.targetId, last, first],
    eventColumns,
  );
  const statusRows = await read<{
    kind: string;
    id: string;
    status: string;
    checkedAt: number | null;
    updatedAt: number;
    generation: number | null;
  }>(
    `SELECT * FROM (SELECT 'subscription' AS kind,id,last_status AS status,last_fetched_at AS checkedAt,updated_at AS updatedAt,NULL AS generation FROM CalendarSubscription WHERE family_id=?1 UNION ALL SELECT 'connection' AS kind,id,status,last_synced_at AS checkedAt,updated_at AS updatedAt,generation FROM CalendarConnection WHERE family_id=?1) ORDER BY kind,id LIMIT 101`,
    [actor.familyId],
    statusColumns,
  );
  const statuses = statusRows.map((row) => {
    const parsed = scheduleSourceStatus.safeParse({
      ...row,
      checkedAt: row.checkedAt === null ? null : new Date(row.checkedAt),
      updatedAt: new Date(row.updatedAt),
    });
    if (!parsed.success) throw new ScheduleReviewError("UNAVAILABLE");
    return parsed.data;
  });
  const rows: ScheduleComparisonRow[] = events.map((row) => ({
    ...row,
    start: new Date(row.start),
    end: new Date(row.end),
  }));
  const prepared = buildScheduleSnapshot(
    actor,
    user.role as "parent" | "teen" | "child",
    scope,
    rows,
    statuses,
    now,
  );
  return {
    prepared,
    checks(target: Pick<D1Store, "prepare">): D1Statement[] {
      return observed.map(({ sql, values, columns, rows }) =>
        d1WriteCheck(
          target,
          `(SELECT json_group_array(json_array(${columns.map((column) => '"' + column + '"').join(",")})) FROM (${sql})) IS ?`,
          [...values, JSON.stringify(rows)],
        ),
      );
    },
  };
}
export async function readD1ScheduleSnapshot(
  actor: ScheduleActor,
  scope: ScheduleReviewScope,
  database?: D1Store,
  now = new Date(),
) {
  const db = database ?? (await getD1Database());
  for (let attempt = 0; attempt < 3; attempt++) {
    const capture = await captureD1ScheduleSource(actor, scope, db, now);
    try {
      await db.withSession("first-primary").batch(capture.checks(db));
      return {
        snapshot: capture.prepared.snapshot,
        evaluatedAt: now.toISOString(),
      };
    } catch (error) {
      if (!isD1WriteConflict(error)) throw error;
    }
  }
  throw new ScheduleReviewError("STALE");
}

export async function previewD1ScheduleQuery(
  actor: ScheduleActor,
  query: ScheduleReviewQuery,
  database?: D1Store,
  now = new Date(),
) {
  requireScheduleOwner(query, actor);
  const reply = await readD1ScheduleSnapshot(
    actor,
    scopeForScheduleCommand(query),
    database,
    now,
  );
  planScheduleReview(reply.snapshot, query, now);
  return reply;
}

export async function authorizeD1ScheduleActor(
  db: D1ReadClient,
  actor: ScheduleActor,
) {
  const user = await db.user.findUnique({
    where: { id: actor.userId },
    select: { family_id: true, role: true, token_version: true },
  });
  if (!user || user.token_version !== actor.tokenVersion)
    throw new ScheduleReviewError("UNAUTHORIZED");
  if (
    user.family_id !== actor.familyId ||
    !["parent", "teen", "child"].includes(user.role)
  )
    throw new ScheduleReviewError("FORBIDDEN");
  const family = await db.family.findUnique({
    where: { id: actor.familyId },
    select: { features: true },
  });
  if (!family) throw new ScheduleReviewError("FORBIDDEN");
  return {
    role: user.role as "parent" | "teen" | "child",
    calendarEnabled: isFeatureEnabled(
      normalizeFeatures(family.features),
      "calendar",
    ),
  };
}
export async function validatedD1ScheduleRead<T>(
  read: (db: D1ReadClient) => Promise<T>,
  database?: D1Store,
  additionalChecks?: (target: Pick<D1Store, "prepare">) => D1Statement[],
) {
  const store = database ?? (await getD1Database());
  for (let attempt = 0; attempt < 3; attempt++) {
    const captured = await captureD1Reads(read, store as unknown as NativeD1);
    try {
      await store
        .withSession("first-primary")
        .batch([
          ...captured.checks(store),
          ...(additionalChecks?.(store) ?? []),
        ]);
      return captured.value;
    } catch (error) {
      if (!isD1WriteConflict(error)) throw error;
    }
  }
  throw new ScheduleReviewError("STALE");
}
