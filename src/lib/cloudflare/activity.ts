/** Native D1 activity-feed reader. Legacy analytics rows and private timeline
 * facts keep the same visibility boundary as the PostgreSQL activity route. */
import type { EffectResult } from "../idempotency";
import { PRIVATE_TIMELINE_ACTIONS } from "../review-inbox/timeline-contract";
import {
  afterActivityCursor,
  encodeActivityCursor,
  type ActivityPaging,
} from "../activity-paging";
import type { D1Store } from "./database";
import { getD1Database } from "./database";

export type D1ActivityActor = {
  userId: string;
  familyId: string;
  role: string;
  generation: number;
};

const failure = (status: number, error: string): EffectResult => ({
  status,
  body: { error },
});

function stripTimelineMarker(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value);
  try {
    return JSON.parse(text)?.timeline === 1 ? null : text;
  } catch {
    return text;
  }
}

function dateValue(value: unknown): Date | null {
  const date =
    value instanceof Date
      ? value
      : new Date(typeof value === "number" ? value : String(value));
  return Number.isFinite(date.getTime()) ? date : null;
}

/** Read household activity with the legacy feed's exact pagination contract. */
export async function readD1Activity(
  actor: D1ActivityActor,
  options: {
    paged: boolean;
    paging: ActivityPaging | null;
    before: Date | null;
    limit: number;
  },
  database?: D1Store,
): Promise<EffectResult> {
  const db = (database ?? (await getD1Database())).withSession("first-primary");
  const actorRow = await db
    .prepare(`SELECT family_id,role,token_version FROM "User" WHERE id=?1`)
    .bind(actor.userId)
    .first<{
      family_id: string | null;
      role: string;
      token_version: number;
    }>();
  if (
    !actorRow ||
    actorRow.family_id !== actor.familyId ||
    actorRow.role !== actor.role ||
    actorRow.token_version !== actor.generation
  )
    return failure(401, "Unauthorized");
  const now = Date.now();
  // Housekeeping mirrors pruneLegacyAnalytics and is intentionally best
  // effort: feed availability must not depend on cleanup succeeding.
  try {
    await db
      .prepare(
        `DELETE FROM "Activity"
          WHERE family_id=?1 AND created_at<?2
            AND type LIKE 'event\\_%' ESCAPE '\\'
            AND type <> 'event_created'`,
      )
      .bind(actor.familyId, now - 90 * 86400000)
      .run();
  } catch {
    // Older D1 snapshots may not have the legacy index; the read remains safe.
  }

  const args: Array<string | number> = [actor.familyId];
  const predicates = [
    `a.family_id=?1`,
    `(a.type NOT LIKE 'event\\_%' ESCAPE '\\' OR a.type='event_created')`,
    `a.type NOT IN (${PRIVATE_TIMELINE_ACTIONS.map((_, i) => `?${i + 2}`).join(",")})`,
  ];
  args.push(...PRIVATE_TIMELINE_ACTIONS);
  if (options.paging?.ok && options.paging.cursor) {
    args.push(
      options.paging.cursor.createdAt.getTime(),
      options.paging.cursor.id,
    );
    predicates.push(
      `(a.created_at<?${args.length - 1} OR (a.created_at=?${args.length - 1} AND a.id>?${args.length}))`,
    );
  }
  if (options.before) {
    args.push(options.before.getTime());
    predicates.push(`a.created_at<?${args.length}`);
  }
  const take = options.paged ? options.limit + 1 : options.limit;
  const rows = await db
    .prepare(
      `SELECT a.id,a.family_id,a.user_id,a.subject_member_id,a.subject_member_erased,
              a.type,a.title,a.description,a.metadata,a.created_at,
              u.id AS actor_id,u.name AS actor_name,u.avatar_url AS actor_avatar
         FROM "Activity" a
         JOIN "User" u ON u.id=a.user_id AND u.family_id=a.family_id
        WHERE ${predicates.join(" AND ")}
        ORDER BY a.created_at DESC,a.id ASC LIMIT ${take}`,
    )
    .bind(...args)
    .all<{
      id: string;
      family_id: string;
      user_id: string;
      subject_member_id: string | null;
      subject_member_erased: number | boolean;
      type: string;
      title: string;
      description: string | null;
      metadata: unknown;
      created_at: unknown;
      actor_id: string;
      actor_name: string | null;
      actor_avatar: string | null;
    }>();
  const page = options.paged
    ? rows.results.slice(0, options.limit)
    : rows.results;
  const activities = page.map((row) => ({
    id: row.id,
    family_id: row.family_id,
    user_id: row.user_id,
    subject_member_id: row.subject_member_id,
    subject_member_erased: Boolean(row.subject_member_erased),
    type: row.type,
    title: row.title,
    description: row.description,
    metadata: stripTimelineMarker(row.metadata),
    created_at: dateValue(row.created_at)?.toISOString() ?? null,
    user: {
      id: row.actor_id,
      name: row.actor_name,
      avatar_url: row.actor_avatar,
    },
  }));
  return {
    status: 200,
    body: {
      activities,
      ...(options.paged
        ? {
            nextCursor:
              rows.results.length > options.limit && page.length
                ? encodeActivityCursor(actor.familyId, {
                    created_at: dateValue(page[page.length - 1]!.created_at)!,
                    id: page[page.length - 1]!.id,
                  })
                : null,
          }
        : {}),
    },
  };
}
