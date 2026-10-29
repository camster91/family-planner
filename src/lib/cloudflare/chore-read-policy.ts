import { normalizeFeatures, isFeatureEnabled } from "@/lib/features";
import { getD1Database, type D1Store, type SqlValue } from "./database";
import {
  routineOccurrencePolicy,
  type RoutineVisibilityReadScope,
  type RoutineOccurrenceSnapshot,
} from "@/lib/routine-occurrence-policy";
import type {
  ProfileHydrated,
  HydratedProfileMember,
} from "@/lib/chore-profile-read";
import { choreStreakDays } from "@/lib/chore-streak-read";

/** Exact source metadata, independently joined to the household-owned root.
 * ID sets use a bound JSON value, not hundreds of SQLite bind parameters.
 * Keyset batches bound result size while retaining the complete scoped policy.
 */
export async function readD1RoutineOccurrenceRows(
  familyId: string,
  scope: RoutineVisibilityReadScope = {},
  onlyOpen = false,
  database?: D1Store,
) {
  if (scope.ids?.length === 0) return [];
  const session = (database ?? (await getD1Database())).withSession(
      "first-primary",
    ),
    rows: RoutineOccurrenceSnapshot[] = [];
  let after: string | null = null;
  for (;;) {
    const values: SqlValue[] = [
      familyId,
      scope.ids ? JSON.stringify([...new Set(scope.ids)]) : null,
      scope.from?.getTime() ?? null,
      scope.through?.getTime() ?? null,
      scope.before?.getTime() ?? null,
      after,
    ];
    const page = await session
      .prepare(
        `SELECT c.id,c.recurrence_id,r.id AS root_id,r.recurrence_id AS root_recurrence_id,
      c.routine_series_config AS own_config,r.routine_series_config AS series_config,c.due_date,c.status,c.photo_url,c.photo_verified,c.verified_at,c.verified_notes,c.completed_at,c.successor_id,c.member_subject_erased
      FROM "Chore" c LEFT JOIN "Chore" r ON r.id=c.recurrence_id AND r.family_id=c.family_id
      WHERE c.family_id=?1 ${onlyOpen ? "AND c.status IN ('pending','in_progress','overdue')" : ""}
      AND (?2 IS NULL OR c.id IN (SELECT value FROM json_each(?2))) AND (?3 IS NULL OR c.due_date>=?3)
      AND (?4 IS NULL OR c.due_date<=?4) AND (?5 IS NULL OR c.due_date<?5) AND (?6 IS NULL OR c.id>?6)
      AND (c.routine_series_config IS NOT NULL OR r.routine_series_config IS NOT NULL) ORDER BY c.id LIMIT 500`,
      )
      .bind(...values)
      .all<{
        id: string;
        recurrence_id: string | null;
        root_id: string | null;
        root_recurrence_id: string | null;
        own_config: string | null;
        series_config: string | null;
        due_date: number;
        status: string;
        photo_url: string | null;
        photo_verified: number;
        verified_at: number | null;
        verified_notes: string | null;
        completed_at: number | null;
        successor_id: string | null;
        member_subject_erased: number;
      }>();
    rows.push(
      ...page.results.map((row) => ({
        ...row,
        own_config: row.own_config === null ? null : JSON.parse(row.own_config),
        series_config:
          row.series_config === null ? null : JSON.parse(row.series_config),
        due_date: new Date(row.due_date),
        photo_verified: row.photo_verified !== 0,
        member_subject_erased: row.member_subject_erased !== 0,
        verified_at:
          row.verified_at === null ? null : new Date(row.verified_at),
        completed_at:
          row.completed_at === null ? null : new Date(row.completed_at),
      })),
    );
    if (page.results.length < 500) return rows;
    after = page.results.at(-1)!.id;
  }
}
export async function hiddenD1RoutineOccurrenceIds(
  familyId: string,
  scope: RoutineVisibilityReadScope = {},
  database?: D1Store,
) {
  return (await readD1RoutineOccurrenceRows(familyId, scope, true, database))
    .filter((row) =>
      ["inactive", "unsupported"].includes(routineOccurrencePolicy(row)),
    )
    .map((row) => row.id);
}
export async function scheduledOnceD1RoutineOccurrenceIds(
  familyId: string,
  ids: readonly string[],
  database?: D1Store,
) {
  return new Set(
    (await readD1RoutineOccurrenceRows(familyId, { ids }, false, database))
      .filter((row) => routineOccurrencePolicy(row) === "scheduled-once")
      .map((row) => row.id),
  );
}
export async function hydrateD1ChoreProfileMembers<
  T extends { assigned_member_id?: string | null },
>(
  familyId: string,
  rows: readonly T[],
  database?: D1Store,
): Promise<ProfileHydrated<T>[]> {
  const store = database ?? (await getD1Database()),
    ids = [
      ...new Set(
        rows.flatMap((row) =>
          row.assigned_member_id ? [row.assigned_member_id] : [],
        ),
      ),
    ],
    members = new Map<string, HydratedProfileMember>();
  const session = store.withSession("first-primary");
  for (let offset = 0; offset < ids.length; offset += 200) {
    const batch = ids.slice(offset, offset + 200),
      requested = new Set(batch);
    const found = await session
      .prepare(
        `SELECT m.id,m.family_id,m.name,m.role,m.age,m.archived_at,m.erasure_user_id,
      lm.user_id AS legacy_user,al.user_id AS linked_user FROM "HouseholdMember" m
      LEFT JOIN "HouseholdMemberLegacyMapping" lm ON lm.member_id=m.id AND lm.family_id=m.family_id
      LEFT JOIN "HouseholdMemberAccountLink" al ON al.member_id=m.id AND al.family_id=m.family_id
      WHERE m.family_id=?1 AND m.id IN (SELECT value FROM json_each(?2)) LIMIT ?3`,
      )
      .bind(familyId, JSON.stringify(batch), batch.length + 1)
      .all<{
        id: string;
        family_id: string;
        name: string;
        role: string;
        age: number | null;
        archived_at: number | null;
        erasure_user_id: string | null;
        legacy_user: string | null;
        linked_user: string | null;
      }>();
    if (found.results.length > batch.length)
      throw new Error("Chore profile read exceeded its bound");
    for (const row of found.results) {
      if (
        row.family_id !== familyId ||
        !requested.has(row.id) ||
        members.has(row.id)
      )
        throw new Error("Invalid chore profile scope");
      const { legacy_user, linked_user, ...member } = row;
      members.set(row.id, {
        ...member,
        archived_at:
          row.archived_at === null ? null : new Date(row.archived_at),
        legacy_mapping: legacy_user === null ? null : { user_id: legacy_user },
        account_link: linked_user === null ? null : { user_id: linked_user },
      });
    }
  }
  return rows.map((row) => ({
    ...row,
    assigneeMember: row.assigned_member_id
      ? (members.get(row.assigned_member_id) ?? null)
      : undefined,
  }));
}
export async function readD1ChoreStreaks(
  familyId: string,
  visibleAssignees: readonly (string | null | undefined)[],
  now = new Date(),
  database?: D1Store,
) {
  const session = (database ?? (await getD1Database())).withSession(
      "first-primary",
    ),
    days = choreStreakDays(now),
    allowed = new Set(days),
    sorted = [...allowed].sort();
  const ids = [
      ...new Set(
        visibleAssignees.filter(
          (id): id is string => typeof id === "string" && id.length > 0,
        ),
      ),
    ],
    output: Record<string, number> = Object.create(null);
  const from = Date.parse(sorted[0] + "T00:00:00Z"),
    through = Date.parse(sorted.at(-1)! + "T00:00:00Z") + 86400000;
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50),
      requested = new Set(batch),
      byId = new Map<string, Set<string>>();
    const rows = await session
      .prepare(
        `SELECT assigned_to,strftime('%Y-%m-%d',completed_at/1000.0,'unixepoch') AS day FROM "Chore"
      WHERE family_id=?1 AND assigned_to IN (SELECT value FROM json_each(?2)) AND status IN ('completed','verified') AND completed_at>=?3 AND completed_at<?4
      GROUP BY assigned_to,day LIMIT ?5`,
      )
      .bind(
        familyId,
        JSON.stringify(batch),
        from,
        through,
        batch.length * allowed.size + 1,
      )
      .all<{ assigned_to: string; day: string }>();
    if (rows.results.length > batch.length * allowed.size)
      throw new Error("Streak projection exceeded its bound");
    for (const row of rows.results) {
      if (
        !requested.has(row.assigned_to) ||
        !allowed.has(row.day) ||
        byId.get(row.assigned_to)?.has(row.day)
      )
        throw new Error("Invalid streak projection scope");
      const set = byId.get(row.assigned_to) ?? new Set<string>();
      set.add(row.day);
      byId.set(row.assigned_to, set);
    }
    for (const id of batch) {
      let streak = 0;
      for (const day of days) {
        if (!byId.get(id)?.has(day)) break;
        streak++;
      }
      output[id] = streak >= 3 ? streak : 0;
    }
  }
  return output;
}

/** Minimal owned event cue for child/teen missions, never parent planning data. */
export async function readD1OwnPreparationContext(
  input: { userId: string; familyId: string; role: string; choreIds: string[] },
  database?: D1Store,
) {
  const ids = [...new Set(input.choreIds)].slice(0, 150);
  if (!ids.length || !["child", "teen"].includes(input.role)) return {};
  const result = await (database ?? (await getD1Database()))
    .withSession("first-primary")
    .prepare(
      `SELECT c.id AS chore_id,e.title AS event_title,f.features
    FROM "EventPreparationStep" s JOIN "EventPreparation" p ON p.id=s.preparation_id AND p.family_id=s.family_id
    JOIN "Chore" c ON c.id=s.chore_id AND c.family_id=s.family_id JOIN "Event" e ON e.id=p.event_id AND e.family_id=p.family_id
    JOIN "Family" f ON f.id=p.family_id JOIN "User" u ON u.id=?1 AND u.family_id=p.family_id AND u.role=?2
    WHERE p.family_id=?3 AND u.role IN ('child','teen') AND c.assigned_to=u.id AND c.assigned_member_id IS NULL
    AND c.member_subject_erased=0 AND c.is_template=0 AND c.id IN (SELECT value FROM json_each(?4)) ORDER BY c.id LIMIT 150`,
    )
    .bind(input.userId, input.role, input.familyId, JSON.stringify(ids))
    .all<{ chore_id: string; event_title: string; features: string | null }>();
  const allowed = new Set(ids);
  return Object.fromEntries(
    result.results.flatMap((row) => {
      const features = normalizeFeatures(
        row.features === null ? null : JSON.parse(row.features),
      );
      return allowed.has(row.chore_id) &&
        typeof row.event_title === "string" &&
        isFeatureEnabled(features, "calendar") &&
        isFeatureEnabled(features, "chores")
        ? [[row.chore_id, { eventTitle: row.event_title.slice(0, 512) }]]
        : [];
    }),
  );
}

/**
 * Preparation context is guarded by more than the two additive tables on the
 * PostgreSQL path: epoch/identity/lifecycle triggers are part of its safety
 * contract. D1 currently has the tables but not those guards, so callers must
 * keep the feature paused rather than treating table presence as readiness.
 */
export async function d1EventPreparationStorageAvailable(
  database?: D1Store,
) {
  const session = (database ?? (await getD1Database())).withSession(
    "first-primary",
  );
  try {
    const rows = await session
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('EventPreparation','EventPreparationStep'))=2 AS tables_ready,
          (SELECT COUNT(*) FROM pragma_table_info('Event') WHERE name IN ('schedule_generation','schedule_epoch','preparation_epoch'))=3 AS event_ready,
          (SELECT COUNT(*) FROM pragma_table_info('Chore') WHERE name IN ('responsibility_generation','responsibility_epoch','preparation_epoch'))=3 AS chore_ready,
          (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name IN ('herewoven_preparation_epoch','herewoven_preparation_event_move','herewoven_preparation_identity','herewoven_preparation_lifecycle','herewoven_preparation_step_version','herewoven_preparation_chore_move','herewoven_preparation_task_state'))=7 AS guards_ready`,
      )
      .first<{
        tables_ready: number;
        event_ready: number;
        chore_ready: number;
        guards_ready: number;
      }>();
    return Boolean(
      rows?.tables_ready &&
        rows.event_ready &&
        rows.chore_ready &&
        rows.guards_ready,
    );
  } catch {
    // A partially migrated D1 must remain an explicit paused surface.
    return false;
  }
}
