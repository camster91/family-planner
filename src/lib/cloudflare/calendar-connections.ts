import type { Provider } from "@/lib/calendar-sync/config";
import { PROVIDER_LABELS, isProvider } from "@/lib/calendar-sync/config";
import type { ConnectionDto, PushMode } from "@/lib/calendar-sync/sync";
import { getD1Database, type D1Store, type SqlValue } from "./database";

export type CalendarConnectionActor = {
  userId: string;
  familyId: string;
  role: string;
  generation: number;
};
type ConnectionRow = {
  id: string;
  family_id: string;
  user_id: string;
  provider: string;
  calendar_id: string | null;
  calendar_name: string | null;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  token_expires_at: number | null;
  sync_cursor: string | null;
  push_mode: string;
  generation: number;
  status: string;
  last_synced_at: number | null;
  last_error: string | null;
  conflicts_count: number;
  last_conflict_at: number | null;
  created_at: number;
  owner_name: string | null;
};
export const MAX_D1_CONNECTIONS_PER_FAMILY = 6;
export const MAX_CALENDAR_CONNECTIONS = MAX_D1_CONNECTIONS_PER_FAMILY;
const AUTH = `EXISTS (SELECT 1 FROM "User" u JOIN "Family" f ON f.id=u.family_id
  WHERE u.id=?1 AND u.family_id=?2 AND u.token_version=?4)`;
const PARENT_AUTH = `EXISTS (SELECT 1 FROM "User" u JOIN "Family" f ON f.id=u.family_id
  WHERE u.id=?1 AND u.family_id=?2 AND u.role='parent' AND u.token_version=?4)`;
const COLUMNS = `c.id,c.provider,c.calendar_id,c.calendar_name,c.push_mode,c.status,c.last_synced_at,c.last_error,
  c.conflicts_count,c.last_conflict_at,c.user_id,u.name AS owner_name`;
const actorArgs = (actor: CalendarConnectionActor): SqlValue[] => [
  actor.userId,
  actor.familyId,
  actor.role,
  actor.generation,
];
const validActor = (actor: CalendarConnectionActor, parent = false) =>
  actor.familyId.length > 0 &&
  Number.isSafeInteger(actor.generation) &&
  actor.generation >= 0 &&
  (parent ? actor.role === "parent" : actor.role === "parent");

function dto(row: ConnectionRow, viewerId: string): ConnectionDto {
  return {
    id: row.id,
    provider: row.provider,
    provider_label: isProvider(row.provider)
      ? PROVIDER_LABELS[row.provider as Provider]
      : row.provider,
    calendar_id: row.calendar_id,
    calendar_name: row.calendar_name,
    push_mode: row.push_mode || "linked",
    status: row.status || "pending",
    last_synced_at:
      row.last_synced_at === null
        ? null
        : new Date(row.last_synced_at).toISOString(),
    last_error: row.last_error,
    conflicts_count: row.conflicts_count ?? 0,
    last_conflict_at:
      row.last_conflict_at === null
        ? null
        : new Date(row.last_conflict_at).toISOString(),
    owner: { id: row.user_id, name: row.owner_name ?? "Member" },
    is_mine: row.user_id === viewerId,
  };
}

const select = (actor: CalendarConnectionActor, extra = "") =>
  `SELECT ${COLUMNS} FROM "CalendarConnection" c JOIN "User" u ON u.id=c.user_id AND u.family_id=c.family_id
   WHERE c.family_id=?2 AND ${AUTH} ${extra}`;

export async function readD1CalendarConnections(
  actor: CalendarConnectionActor,
  database?: D1Store,
) {
  if (!validActor(actor)) return null;
  const db = (database ?? (await getD1Database())).withSession("first-primary");
  const rows = await db
    .prepare(`${select(actor)} ORDER BY c.created_at,c.id LIMIT ?5`)
    .bind(...actorArgs(actor), MAX_D1_CONNECTIONS_PER_FAMILY)
    .all<ConnectionRow>();
  return rows.results.map((row) => dto(row, actor.userId));
}

export async function readD1CalendarConnection(
  actor: CalendarConnectionActor,
  id: string,
  database?: D1Store,
) {
  if (!validActor(actor)) return null;
  const db = (database ?? (await getD1Database())).withSession("first-primary");
  return dtoOrNull(
    await db
      .prepare(`${select(actor, "AND c.id=?5")}`)
      .bind(...actorArgs(actor), id)
      .first<ConnectionRow>(),
    actor.userId,
  );
}

export type D1ConnectionSecretRow = ConnectionRow;
export async function readD1CalendarConnectionSecret(
  actor: CalendarConnectionActor,
  id: string,
  database?: D1Store,
): Promise<D1ConnectionSecretRow | null> {
  if (!validActor(actor)) return null;
  const db = (database ?? (await getD1Database())).withSession("first-primary");
  return db
    .prepare(
      `SELECT c.*,u.name AS owner_name FROM "CalendarConnection" c JOIN "User" u ON u.id=c.user_id AND u.family_id=c.family_id
    WHERE c.id=?5 AND c.family_id=?2 AND ${AUTH}`,
    )
    .bind(...actorArgs(actor), id)
    .first<D1ConnectionSecretRow>();
}

function dtoOrNull(
  row: ConnectionRow | null,
  viewerId: string,
): ConnectionDto | null {
  return row ? dto(row, viewerId) : null;
}

export type ConnectionCommitOutcome =
  "created" | "updated" | "no_refresh_token" | "limit" | "gone";
export async function commitD1CalendarConnection(
  actor: CalendarConnectionActor,
  provider: Provider,
  data: {
    access_token_enc: string;
    refresh_token_enc?: string | null;
    token_expires_at: Date;
    sync_cursor?: string | null;
    status?: string;
    last_error?: string | null;
  },
  database?: D1Store,
): Promise<ConnectionCommitOutcome> {
  if (!validActor(actor, true) || actor.role !== "parent") return "gone";
  const db = (database ?? (await getD1Database())).withSession("first-primary");
  const existing = await db
    .prepare(
      `SELECT id,refresh_token_enc FROM "CalendarConnection" WHERE family_id=?2 AND user_id=?1 AND provider=?5`,
    )
    .bind(...actorArgs(actor), provider)
    .first<{ id: string; refresh_token_enc: string | null }>();
  if (existing && !data.refresh_token_enc && !existing.refresh_token_enc)
    return "no_refresh_token";
  const id = existing?.id ?? crypto.randomUUID();
  const now = Date.now();
  const tokenSql: string[] = [
    "access_token_enc=?6",
    "token_expires_at=?7",
    "sync_cursor=?8",
    "status=?9",
    "last_error=?10",
    "updated_at=?11",
  ];
  const tokenValues: SqlValue[] = [
    data.access_token_enc,
    data.token_expires_at.getTime(),
    data.sync_cursor ?? null,
    data.status ?? "pending",
    data.last_error ?? null,
    now,
  ];
  if (data.refresh_token_enc !== undefined) {
    tokenSql.push("refresh_token_enc=?12");
    tokenValues.push(data.refresh_token_enc);
  }
  const statement = existing
    ? db
        .prepare(
          `UPDATE "CalendarConnection" SET ${tokenSql.join(",")},generation=generation+1 WHERE id=?5 AND family_id=?2 AND ${PARENT_AUTH}`,
        )
        .bind(...actorArgs(actor), id, ...tokenValues)
    : db
        .prepare(
          `INSERT INTO "CalendarConnection" (id,family_id,user_id,provider,access_token_enc,refresh_token_enc,token_expires_at,sync_cursor,status,last_error,created_at,updated_at)
      SELECT ?5,?2,?1,?6,?7,?8,?9,?10,?11,?12,?13,?13 WHERE ${PARENT_AUTH}
      AND (SELECT COUNT(*) FROM "CalendarConnection" WHERE family_id=?2)<?14`,
        )
        .bind(
          ...actorArgs(actor),
          id,
          provider,
          data.access_token_enc,
          data.refresh_token_enc ?? null,
          data.token_expires_at.getTime(),
          data.sync_cursor ?? null,
          data.status ?? "pending",
          data.last_error ?? null,
          now,
          MAX_D1_CONNECTIONS_PER_FAMILY,
        );
  const result = await db.batch<{ id: string }>([
    db
      .prepare(`SELECT 1 AS admitted WHERE ${PARENT_AUTH}`)
      .bind(...actorArgs(actor)),
    statement,
    db
      .prepare(
        `SELECT id FROM "CalendarConnection" WHERE id=?5 AND family_id=?2`,
      )
      .bind(...actorArgs(actor), id),
  ]);
  if (!result[0].results.length) return "gone";
  if (!result[1].meta.changes) return existing ? "gone" : "limit";
  return existing ? "updated" : "created";
}

export async function changeD1CalendarConnection(
  actor: CalendarConnectionActor,
  id: string,
  calendar: { id: string; name: string },
  database?: D1Store,
): Promise<number | null> {
  if (!validActor(actor, true) || actor.role !== "parent") return null;
  const db = (database ?? (await getD1Database())).withSession("first-primary");
  const result = await db.batch<{ id: string }>([
    db
      .prepare(`SELECT 1 AS admitted WHERE ${PARENT_AUTH}`)
      .bind(...actorArgs(actor)),
    db
      .prepare(
        `UPDATE "CalendarConnection" SET generation=generation+1,calendar_id=?6,calendar_name=?7,sync_cursor=NULL,status='pending',last_error=NULL,updated_at=?8
      WHERE id=?5 AND family_id=?2 AND ${PARENT_AUTH}`,
      )
      .bind(...actorArgs(actor), id, calendar.id, calendar.name, Date.now()),
    db
      .prepare(
        `DELETE FROM "CalendarEventLink" WHERE connection_id=?5 AND family_id=?2`,
      )
      .bind(...actorArgs(actor), id),
    db
      .prepare(
        `DELETE FROM "Event" WHERE family_id=?2 AND source_connection_id=?5 RETURNING id`,
      )
      .bind(...actorArgs(actor), id),
  ]);
  return result[0].results.length && result[1].meta.changes
    ? result[3].results.length
    : null;
}

export async function updateD1CalendarPushMode(
  actor: CalendarConnectionActor,
  id: string,
  pushMode: PushMode,
  database?: D1Store,
): Promise<boolean | null> {
  if (!validActor(actor, true) || actor.role !== "parent") return null;
  const db = (database ?? (await getD1Database())).withSession("first-primary");
  const result = await db
    .prepare(
      `UPDATE "CalendarConnection" SET push_mode=?6,updated_at=?7
       WHERE id=?5 AND family_id=?2 AND ${PARENT_AUTH}`,
    )
    .bind(...actorArgs(actor), id, pushMode, Date.now())
    .run();
  return result.meta.changes > 0;
}

export async function clearD1CalendarConnection(
  actor: CalendarConnectionActor,
  id: string,
  database?: D1Store,
): Promise<number | null> {
  if (!validActor(actor)) return null;
  const db = (database ?? (await getD1Database())).withSession("first-primary");
  const result = await db.batch<{ id: string }>([
    db.prepare(`SELECT 1 AS admitted WHERE ${AUTH}`).bind(...actorArgs(actor)),
    db
      .prepare(
        `DELETE FROM "Event" WHERE family_id=?2 AND source_connection_id=?5 RETURNING id`,
      )
      .bind(...actorArgs(actor), id),
    db
      .prepare(
        `DELETE FROM "CalendarConnection" WHERE id=?5 AND family_id=?2 AND ${AUTH} RETURNING id`,
      )
      .bind(...actorArgs(actor), id),
  ]);
  if (!result[0].results.length) return null;
  return result[2].results.length ? result[1].results.length : null;
}

export function d1ConnectionDto(
  row: D1ConnectionSecretRow,
  viewerId: string,
): ConnectionDto {
  return dto(row, viewerId);
}
