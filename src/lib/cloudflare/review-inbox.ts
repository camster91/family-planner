import { isFeatureEnabled, normalizeFeatures, FEATURES } from "@/lib/features";
import { isProfileChoreEnabled } from "@/lib/profile-chore-gates";
import { eventPreparationReady } from "@/lib/event-preparation/owner";
import { scheduleEventToken } from "@/lib/calendar-planning/schedule-source";
import { memberIdentityIdSchema } from "@/lib/member-subject-contract";
import { AUDIT_ACTIONS } from "@/lib/household-audit-contract";
import {
  COORDINATION_ACTIONS,
  timelineAction,
  timelinePage,
  timelineQuery,
  timelineTarget,
  type TimelinePage,
  type TimelineTarget,
} from "@/lib/review-inbox/timeline-contract";
import {
  decodeTimelineCursor,
  TimelineAccessError,
} from "@/lib/review-inbox/timeline";
import { inboxQuery, type InboxPage } from "@/lib/review-inbox/read";
import { getD1Database, type D1Store, type SqlValue } from "./database";

type ReviewActor = {
  userId: string;
  familyId: string;
  role: string;
  tokenVersion: number;
};

type Authority = {
  id: string;
  family_id: string | null;
  role: string;
  token_version: number;
  features: string | null;
};

type TimelineActor = {
  userId: string;
  familyId: string;
  tokenVersion: number;
};

type TimelineCandidate = {
  id: string;
  stream: "activity" | "audit";
  action: string;
  at: Date;
  actor: { name: string; family_id: string | null } | null;
  tablet: boolean;
  metadata: string | null;
  featureKey: string | null;
};

function jsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function dateValue(value: unknown): Date {
  const date = new Date(Number(value));
  if (!Number.isFinite(date.getTime()))
    throw new Error("Invalid review timestamp");
  return date;
}

function authorityQuery() {
  return `SELECT u.id,u.family_id,u.role,u.token_version,f.features
    FROM "User" u LEFT JOIN "Family" f ON f.id=?2
    WHERE u.id=?1`;
}

async function currentAuthority(
  db: Pick<D1Store, "prepare">,
  actor: ReviewActor,
): Promise<Authority | null> {
  const row = await db
    .prepare(authorityQuery())
    .bind(actor.userId, actor.familyId)
    .first<Authority>();
  return row &&
    row.family_id === actor.familyId &&
    row.role === actor.role &&
    row.token_version === actor.tokenVersion
    ? row
    : null;
}

function emptyInbox(
  source: InboxPage["source"],
  state: InboxPage["state"],
): InboxPage {
  return { source, items: [], next: null, state };
}

/** Native D1 counterpart of the parent review inbox SSR projection. */
export async function readD1ReviewInbox(
  actor: ReviewActor,
  raw: unknown,
  database?: D1Store,
): Promise<InboxPage> {
  const query = inboxQuery.parse(raw);
  if (
    actor.role !== "parent" ||
    !Number.isSafeInteger(actor.tokenVersion) ||
    actor.tokenVersion < 0
  )
    return emptyInbox(query.source, "forbidden");

  const store = database ?? (await getD1Database());
  const db = store.withSession("first-primary");
  if (
    query.source === "saved" ||
    query.source === "capture" ||
    query.source === "changes"
  )
    return emptyInbox(
      query.source,
      (await currentAuthority(db, actor)) ? "available" : "forbidden",
    );

  if (query.source === "checks") {
    const authority = await currentAuthority(db, actor);
    if (!authority) return emptyInbox(query.source, "forbidden");
    const rows = await db
      .prepare(
        `SELECT id,title FROM "Chore"
        WHERE family_id=?1 AND status='completed' AND is_template=0 AND id>?2
        ORDER BY id ASC LIMIT 21`,
      )
      .bind(actor.familyId, query.after ?? "")
      .all<{ id: string; title: string }>();
    const candidates = rows.results;
    return {
      source: query.source,
      state: "available",
      next: candidates.length > 20 ? candidates[19].id : null,
      items: candidates
        .slice(0, 20)
        .filter(() =>
          isFeatureEnabled(
            normalizeFeatures(jsonValue(authority.features)),
            "chores",
          ),
        )
        .map((row) => ({
          id: row.id,
          title: row.title.slice(0, 512),
          kind: "check" as const,
        })),
    };
  }

  // Event preparation is an additive, release-gated surface. Missing tables
  // mean paused, matching PostgreSQL's compatibility probe; they never become
  // an apparently empty available inbox.
  if (!eventPreparationReady()) return emptyInbox(query.source, "paused");
  const storage = await db
    .prepare(
      `SELECT COUNT(*) AS total FROM sqlite_master
      WHERE type='table' AND name IN ('EventPreparation','EventPreparationStep')`,
    )
    .first<{ total: number }>();
  if (Number(storage?.total) !== 2) return emptyInbox(query.source, "paused");
  const authority = await currentAuthority(db, actor);
  if (!authority) return emptyInbox(query.source, "forbidden");
  const rows = await db
    .prepare(
      `SELECT e.id,e.title,e.schedule_generation AS generation,e.schedule_epoch AS epoch,
        p.reviewed_event_source AS reviewed
      FROM "EventPreparation" p JOIN "Event" e
        ON e.id=p.event_id AND e.family_id=p.family_id
      WHERE p.family_id=?1 AND e.id>?2
      ORDER BY e.id ASC LIMIT 21`,
    )
    .bind(actor.familyId, query.after ?? "")
    .all<{
      id: string;
      title: string;
      generation: string | null;
      epoch: number | null;
      reviewed: string | null;
    }>();
  const features = normalizeFeatures(jsonValue(authority.features));
  return {
    source: query.source,
    state: "available",
    next: rows.results.length > 20 ? rows.results[19].id : null,
    items: rows.results.slice(0, 20).flatMap((row) => {
      if (
        !isFeatureEnabled(features, "chores") ||
        !isFeatureEnabled(features, "calendar")
      )
        return [];
      try {
        if (
          row.generation !== null &&
          row.epoch !== null &&
          scheduleEventToken(actor.familyId, {
            id: row.id,
            generation: row.generation,
            epoch: row.epoch,
          }) === row.reviewed
        )
          return [];
      } catch {
        // Invalid/saturated versions stay in review instead of being cleared.
      }
      return [
        {
          id: row.id,
          title: row.title.slice(0, 512),
          kind: "preparation" as const,
        },
      ];
    }),
  };
}

function cursorWhere(
  stream: "activity" | "audit",
  cursor: ReturnType<typeof decodeTimelineCursor>,
  values: SqlValue[],
): string {
  if (!cursor) return "";
  const at = new Date(cursor.at).getTime();
  if (stream !== cursor.stream) {
    values.push(stream < cursor.stream ? at : at);
    return ` AND a.created_at${stream < cursor.stream ? "<=" : "<"} ?${values.length}`;
  }
  values.push(at, cursor.id);
  return ` AND (a.created_at<?${values.length - 1} OR (a.created_at=?${values.length - 1} AND a.id<?${values.length}))`;
}

function timelineReference(row: TimelineCandidate): TimelineTarget | null {
  if (!row.metadata || row.metadata.length > 4096) return null;
  try {
    const data = JSON.parse(row.metadata);
    const raw =
      data?.timeline === 1
        ? data.target
        : row.action === "event_created"
          ? { kind: "event", id: data?.eventId }
          : ["chore_completed", "chore_verified", "chore_rejected"].includes(
                row.action,
              )
            ? { kind: "chore", id: data?.choreId }
            : null;
    const parsed = timelineTarget.safeParse(raw);
    const allowed =
      row.action === "recipe_created"
        ? ["recipe"]
        : row.action === "responsibility_changed"
          ? ["chore", "pickup", "handoff"]
          : [
                "event_created",
                "preparation_changed",
                "schedule_changed",
              ].includes(row.action)
            ? ["event"]
            : ["chore"];
    return parsed.success &&
      parsed.data.kind !== "settings" &&
      allowed.includes(parsed.data.kind)
      ? parsed.data
      : null;
  } catch {
    return null;
  }
}

function timelineOrigin(
  row: TimelineCandidate,
): TimelinePage["entries"][number]["origin"] {
  if (row.stream === "audit") return "settings";
  if (
    ["preparation_changed", "preparation_routine_copied"].includes(row.action)
  )
    return "preparation";
  if (row.action === "schedule_changed") return "schedule";
  if (row.action === "responsibility_changed") return "responsibility";
  if (row.action === "recipe_created") return "recipes";
  return "app";
}

async function idsQuery(
  db: Pick<D1Store, "prepare">,
  table: string,
  columns: string,
  familyId: string,
  ids: string[],
) {
  if (!ids.length) return [] as any[];
  const placeholders = ids.map((_, index) => `?${index + 2}`).join(",");
  return (
    await db
      .prepare(
        `SELECT ${columns} FROM "${table}" WHERE family_id=?1 AND id IN (${placeholders})`,
      )
      .bind(familyId, ...ids)
      .all<any>()
  ).results;
}

/** Native D1 counterpart of `/api/review/timeline`. */
export async function readD1ChangeTimeline(
  actor: TimelineActor,
  raw: unknown,
  now = new Date(),
  database?: D1Store,
): Promise<TimelinePage> {
  const query = timelineQuery.parse(raw);
  const cursor = decodeTimelineCursor(query.cursor, query.source);
  if (
    !memberIdentityIdSchema.safeParse(actor.userId).success ||
    !memberIdentityIdSchema.safeParse(actor.familyId).success
  )
    throw new TimelineAccessError(401);
  const store = database ?? (await getD1Database());
  const db = store.withSession("first-primary");
  const authority = await db
    .prepare(
      `SELECT u.family_id,u.role,u.token_version FROM "User" u WHERE u.id=?1`,
    )
    .bind(actor.userId)
    .first<{ family_id: string | null; role: string; token_version: number }>();
  if (!authority || authority.token_version !== actor.tokenVersion)
    throw new TimelineAccessError(401);
  if (authority.family_id !== actor.familyId || authority.role !== "parent")
    throw new TimelineAccessError(403);
  const cutoff = now.getTime() - 365 * 86400000;
  const activity: TimelineCandidate[] = [];
  if (query.source !== "settings") {
    const values: SqlValue[] = [
      actor.familyId,
      cutoff,
      ...COORDINATION_ACTIONS,
    ];
    const actions = COORDINATION_ACTIONS.map(
      (_, index) => `?${index + 3}`,
    ).join(",");
    const where = cursorWhere("activity", cursor, values);
    const rows = await db
      .prepare(
        `SELECT a.id,a.type AS action,a.metadata,a.created_at,
        u.name AS actor_name,u.family_id AS actor_family_id
      FROM "Activity" a LEFT JOIN "User" u ON u.id=a.user_id
      WHERE a.family_id=?1 AND a.subject_member_erased=0 AND a.created_at>=?2
        AND a.type IN (${actions})${where}
      ORDER BY a.created_at DESC,a.id DESC LIMIT 21`,
      )
      .bind(...values)
      .all<any>();
    activity.push(
      ...rows.results.map((row) => ({
        id: row.id,
        stream: "activity" as const,
        action: row.action,
        at: dateValue(row.created_at),
        actor:
          row.actor_name === null || row.actor_name === undefined
            ? null
            : { name: row.actor_name, family_id: row.actor_family_id },
        tablet: false,
        metadata: row.metadata,
        featureKey: null,
      })),
    );
  }
  const audit: TimelineCandidate[] = [];
  if (query.source !== "coordination") {
    const values: SqlValue[] = [actor.familyId, cutoff, ...AUDIT_ACTIONS];
    const actions = AUDIT_ACTIONS.map((_, index) => `?${index + 3}`).join(",");
    const where = cursorWhere("audit", cursor, values);
    const rows = await db
      .prepare(
        `SELECT a.id,a.action,a.actor_kind,a.target_type,a.target_id,a.created_at,
        u.name AS actor_name,u.family_id AS actor_family_id
      FROM "AuditLog" a LEFT JOIN "User" u ON u.id=a.actor_user_id
      WHERE a.family_id=?1 AND a.created_at>=?2 AND a.action IN (${actions})${where}
      ORDER BY a.created_at DESC,a.id DESC LIMIT 21`,
      )
      .bind(...values)
      .all<any>();
    audit.push(
      ...rows.results.map((row) => ({
        id: row.id,
        stream: "audit" as const,
        action: row.action,
        at: dateValue(row.created_at),
        actor:
          row.actor_name === null || row.actor_name === undefined
            ? null
            : { name: row.actor_name, family_id: row.actor_family_id },
        tablet: row.actor_kind === "device",
        metadata: null,
        featureKey:
          row.target_type === "feature" &&
          FEATURES.some((feature) => feature.key === row.target_id)
            ? row.target_id
            : null,
      })),
    );
  }
  const candidates = [...activity, ...audit].sort(
    (a, b) =>
      b.at.getTime() - a.at.getTime() ||
      (a.stream === b.stream ? 0 : a.stream < b.stream ? 1 : -1),
  );
  const page = candidates.slice(0, 20);
  const references = page.map(timelineReference);
  const ids = (kind: string) => [
    ...new Set(
      references
        .filter(
          (
            target,
          ): target is Exclude<
            NonNullable<typeof target>,
            { kind: "settings" }
          > =>
            target?.kind === kind,
        )
        .map((target) => target.id),
    ),
  ];
  const family = await db
    .prepare(`SELECT features FROM "Family" WHERE id=?1`)
    .bind(actor.familyId)
    .first<{ features: string | null }>();
  if (!family) throw new TimelineAccessError(403);
  const features = normalizeFeatures(family.features);
  const current = new Map<
    string,
    { title: string | null; target: TimelineTarget }
  >();
  if (isFeatureEnabled(features, "calendar") && ids("event").length)
    for (const row of await idsQuery(
      db,
      "Event",
      "id,title",
      actor.familyId,
      ids("event"),
    ))
      current.set(`event:${row.id}`, {
        title: row.title,
        target: { kind: "event", id: row.id },
      });
  if (isFeatureEnabled(features, "chores") && ids("chore").length) {
    const choreIds = ids("chore"),
      placeholders = choreIds.map((_, index) => `?${index + 2}`).join(",");
    const rows = await db
      .prepare(
        `SELECT id,title FROM "Chore" WHERE family_id=?1 AND id IN (${placeholders}) AND member_subject_erased=0${isProfileChoreEnabled() ? "" : " AND assigned_to IS NOT NULL"}`,
      )
      .bind(actor.familyId, ...choreIds)
      .all<{ id: string; title: string }>();
    for (const row of rows.results)
      current.set(`chore:${row.id}`, {
        title: row.title,
        target: { kind: "chore", id: row.id },
      });
  }
  if (isFeatureEnabled(features, "meals") && ids("recipe").length)
    for (const row of await idsQuery(
      db,
      "Recipe",
      "id,title",
      actor.familyId,
      ids("recipe"),
    ))
      current.set(`recipe:${row.id}`, {
        title: row.title,
        target: { kind: "recipe", id: row.id },
      });
  if (isFeatureEnabled(features, "handoff") && ids("handoff").length)
    for (const row of await idsQuery(
      db,
      "Handoff",
      "id",
      actor.familyId,
      ids("handoff"),
    ))
      current.set(`handoff:${row.id}`, {
        title: null,
        target: { kind: "handoff", id: row.id },
      });
  if (isFeatureEnabled(features, "pickups") && ids("pickup").length)
    for (const row of await idsQuery(
      db,
      "Pickup",
      "id,title",
      actor.familyId,
      ids("pickup"),
    ))
      current.set(`pickup:${row.id}`, {
        title: row.title,
        target: { kind: "pickup", id: row.id },
      });

  const entries: TimelinePage["entries"] = [];
  for (const [index, row] of page.entries()) {
    const action = timelineAction.parse(row.action),
      target = references[index];
    const feature =
      row.action === "recipe_created"
        ? "meals"
        : ["event_created", "preparation_changed", "schedule_changed"].includes(
              row.action,
            )
          ? "calendar"
          : target?.kind === "handoff"
            ? "handoff"
            : target?.kind === "pickup"
              ? "pickups"
              : "chores";
    if (
      row.stream === "activity" &&
      !isFeatureEnabled(features, feature as any)
    )
      continue;
    const visible =
      target && target.kind !== "settings"
        ? current.get(`${target.kind}:${target.id}`)
        : null;
    let actorKind: "person" | "tablet" | "unknown" = row.tablet
      ? "tablet"
      : "person";
    if (row.action === "chore_completed") {
      actorKind = "unknown";
      try {
        const data =
          row.metadata && row.metadata.length <= 4096
            ? JSON.parse(row.metadata)
            : null;
        if (
          data?.timeline === 1 &&
          ["person", "device"].includes(data.actorKind)
        )
          actorKind = data.actorKind === "device" ? "tablet" : "person";
      } catch {
        /* older activity stays unknown */
      }
    }
    entries.push({
      id: `${row.stream}:${row.id}`,
      action,
      at: row.at.toISOString(),
      actor: {
        name:
          actorKind === "person" && row.actor?.family_id === actor.familyId
            ? row.actor.name.slice(0, 80)
            : null,
        kind: actorKind,
      },
      origin: timelineOrigin(row),
      featureKey: row.featureKey,
      target:
        row.stream === "audit"
          ? { kind: "settings" }
          : (visible?.target ?? null),
      title: visible?.title?.slice(0, 200) ?? null,
      current:
        row.stream === "audit" || visible
          ? "available"
          : target
            ? "unavailable"
            : "unknown",
    });
  }
  const last = page[page.length - 1];
  return timelinePage.parse({
    owner: {
      userId: actor.userId,
      familyId: actor.familyId,
      generation: actor.tokenVersion,
    },
    source: query.source,
    entries,
    nextCursor:
      candidates.length > 20 && last
        ? Buffer.from(
            JSON.stringify({
              at: last.at.toISOString(),
              id: last.id,
              stream: last.stream,
              source: query.source,
            }),
          ).toString("base64url")
        : null,
  });
}
