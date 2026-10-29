import { randomUUID } from "node:crypto";
import type {
  CalendarConnectionActor,
  D1ConnectionSecretRow,
} from "./calendar-connections";
import { readD1CalendarConnectionSecret } from "./calendar-connections";
import { getD1Database, type D1Store, type SqlValue } from "./database";
import { adapterFor, oauthFor } from "@/lib/calendar-sync/providers";
import {
  getProviderConfig,
  isProvider,
  type Provider,
  type ProviderConfig,
} from "@/lib/calendar-sync/config";
import { ProviderHttpError } from "@/lib/calendar-sync/http";
import { DEFAULT_FAMILY_TIMEZONE } from "@/lib/calendar-import/timezone";
import { importWindow } from "@/lib/calendar-import/sync-values";
import {
  fieldsHash,
  isLocalMidnightSpan,
  type SyncedFields,
} from "@/lib/calendar-sync/mapping";
import {
  decryptToken,
  encryptToken,
  needsReencrypt,
  tokenAad,
} from "@/lib/calendar-sync/token-crypto";
import {
  CursorExpiredError,
  OAuthGrantError,
  type CalendarProviderAdapter,
  type OAuthClient,
  type PullResult,
  type RemoteCalendar,
  type RemoteEvent,
} from "@/lib/calendar-sync/types";
import {
  usableCursor,
  cursorIssuedAt,
  packCursor,
} from "@/lib/calendar-sync/cursor";
import type { SyncSummary, SyncCounts } from "@/lib/calendar-sync/sync";

const DAY_MS = 86_400_000;
const TOKEN_SKEW_MS = 60_000;
const MAX_PUSH_PER_RUN = 100;
const PUSH_MODES = ["linked", "all"] as const;
const MESSAGES: Record<string, string> = {
  rate_limited: "The calendar provider is busy. Sync will try again later.",
  network: "Could not reach the calendar provider.",
  timeout: "The calendar provider took too long to respond.",
  too_large: "This calendar has too many changes to sync at once.",
  calendar_gone:
    "This calendar can no longer be reached. Choose another calendar.",
  reauth: "Reconnect this calendar to keep it in sync.",
  reauth_scope:
    "Reconnect this calendar and allow access to your calendar events.",
  not_configured: "This calendar provider is not available.",
  token_unreadable: "Reconnect this calendar to keep it in sync.",
  unknown: "Sync failed. Try again later.",
};

type LinkRow = {
  id: string;
  event_id: string | null;
  external_id: string;
  external_etag: string | null;
  external_updated_at: number | null;
  synced_hash: string | null;
  all_day: number;
};
type EventRow = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  start_time: number;
  end_time: number;
  updated_at: number;
  source_connection_id: string | null;
  source_subscription_id: string | null;
  is_task: number;
};
type NativeSyncDeps = {
  database?: D1Store;
  now?: Date;
  timeZone?: string;
  adapterFor?: (provider: Provider) => CalendarProviderAdapter;
  oauthFor?: (provider: Provider) => OAuthClient;
  configFor?: (provider: Provider) => ProviderConfig | null;
};

function zero(): SyncCounts {
  return { created: 0, updated: 0, deleted: 0 };
}
function actorArgs(actor: CalendarConnectionActor): SqlValue[] {
  return [actor.userId, actor.familyId, actor.role, actor.generation];
}
const AUTH = `EXISTS (SELECT 1 FROM "User" u JOIN "Family" f ON f.id=u.family_id
  WHERE u.id=?1 AND u.family_id=?2 AND u.role='parent' AND u.token_version=?4)`;

function remoteFields(remote: RemoteEvent): SyncedFields {
  return {
    title: remote.title,
    description: remote.description,
    location: remote.location,
    start_time: remote.start,
    end_time: remote.end,
  };
}
function localFields(event: EventRow): SyncedFields {
  return {
    title: event.title,
    description: event.description,
    location: event.location,
    start_time: new Date(event.start_time),
    end_time: new Date(event.end_time),
  };
}
function errorCode(error: unknown): string {
  if (error instanceof ProviderHttpError) {
    if (error.code === "http" && (error.status === 403 || error.status === 404))
      return "calendar_gone";
    if (error.code in MESSAGES) return error.code;
  }
  return "unknown";
}

async function readConnection(
  actor: CalendarConnectionActor,
  id: string,
  database: D1Store,
) {
  return readD1CalendarConnectionSecret(actor, id, database);
}

async function markReauth(
  actor: CalendarConnectionActor,
  connectionId: string,
  generation: number,
  message: string,
  database: D1Store,
) {
  const db = database.withSession("first-primary");
  await db
    .prepare(
      `UPDATE "CalendarConnection" SET status='reauth_required',last_error=?6,access_token_enc=NULL,updated_at=?7
    WHERE id=?5 AND family_id=?2 AND generation=?8 AND ${AUTH}`,
    )
    .bind(
      actor.userId,
      actor.familyId,
      actor.role,
      actor.generation,
      connectionId,
      message,
      Date.now(),
      generation,
    )
    .run();
}

async function accessToken(
  actor: CalendarConnectionActor,
  conn: D1ConnectionSecretRow,
  config: ProviderConfig,
  oauth: OAuthClient,
  now: Date,
  database: D1Store,
  force = false,
): Promise<{ token: string; conn: D1ConnectionSecretRow }> {
  if (!force && conn.access_token_enc) {
    const current = decryptToken(
      conn.access_token_enc,
      tokenAad.access(conn.family_id),
    );
    const expires = conn.token_expires_at ?? 0;
    if (current && expires - TOKEN_SKEW_MS > now.getTime())
      return { token: current, conn };
  }
  const refresh = decryptToken(
    conn.refresh_token_enc,
    tokenAad.refresh(conn.family_id),
  );
  if (!refresh) throw new OAuthGrantError();
  const set = await oauth.refresh(config, refresh);
  const accessEnc = encryptToken(
    set.accessToken,
    tokenAad.access(conn.family_id),
  );
  const refreshEnc =
    set.refreshToken || needsReencrypt(conn.refresh_token_enc)
      ? encryptToken(
          set.refreshToken ?? refresh,
          tokenAad.refresh(conn.family_id),
        )
      : conn.refresh_token_enc;
    const result = await database
    .withSession("first-primary")
    .prepare(
      `UPDATE "CalendarConnection" SET access_token_enc=?6,refresh_token_enc=?7,token_expires_at=?8,updated_at=?9
    WHERE id=?5 AND family_id=?2 AND generation=?10 AND ${AUTH} RETURNING id`,
    )
    .bind(
      actor.userId,
      actor.familyId,
      actor.role,
      actor.generation,
      conn.id,
      accessEnc,
      refreshEnc,
      set.expiresAt.getTime(),
      Date.now(),
      conn.generation,
    )
    .first<{ id: string }>();
  if (!result) throw new SupersededNativeSyncError();
  return {
    token: set.accessToken,
    conn: {
      ...conn,
      access_token_enc: accessEnc,
      refresh_token_enc: refreshEnc,
      token_expires_at: set.expiresAt.getTime(),
    },
  };
}

async function withProviderAuth<T>(
  actor: CalendarConnectionActor,
  conn: D1ConnectionSecretRow,
  config: ProviderConfig,
  oauth: OAuthClient,
  now: Date,
  database: D1Store,
  fn: (token: string) => Promise<T>,
): Promise<T> {
  const access = await accessToken(actor, conn, config, oauth, now, database);
  try {
    return await fn(access.token);
  } catch (error) {
    if (error instanceof ProviderHttpError && error.code === "unauthorized") {
      const retry = await accessToken(
        actor,
        access.conn,
        config,
        oauth,
        now,
        database,
        true,
      );
      return fn(retry.token);
    }
    throw error;
  }
}

export class SupersededNativeSyncError extends Error {
  constructor() {
    super("Calendar connection changed during sync");
    this.name = "SupersededNativeSyncError";
  }
}
export class NativeConnectionNotReadyError extends Error {
  constructor(readonly reason: "not_configured" | "reauth") {
    super(`Calendar connection is not usable (${reason})`);
    this.name = "NativeConnectionNotReadyError";
  }
}

/** Revoke an unsaved or removed native grant without touching D1. */
export async function revokeD1ProviderGrant(
  conn: {
    id: string;
    provider: string;
    access_token_enc: string | null;
    refresh_token_enc: string | null;
  },
  familyId: string,
  deps: Pick<NativeSyncDeps, "configFor" | "oauthFor"> = {},
): Promise<boolean> {
  if (!isProvider(conn.provider)) return false;
  const config = (deps.configFor ?? getProviderConfig)(conn.provider);
  const token =
    decryptToken(conn.refresh_token_enc, tokenAad.refresh(familyId)) ??
    decryptToken(conn.access_token_enc, tokenAad.access(familyId));
  if (!config || !token) return false;
  try {
    await (deps.oauthFor ?? oauthFor)(conn.provider).revoke(config, token);
    return true;
  } catch {
    console.warn("[calendar-sync] revoke failed", { connectionId: conn.id });
    return false;
  }
}

export async function listD1ConnectionCalendars(
  actor: CalendarConnectionActor,
  connectionId: string,
  deps: NativeSyncDeps = {},
): Promise<RemoteCalendar[] | null> {
  const db = deps.database ?? (await getD1Database());
  const now = deps.now ?? new Date();
  const conn = await readConnection(actor, connectionId, db);
  if (!conn) return null;
  if (!isProvider(conn.provider))
    throw new NativeConnectionNotReadyError("not_configured");
  const config = (deps.configFor ?? getProviderConfig)(
    conn.provider as Provider,
  );
  if (!config) throw new NativeConnectionNotReadyError("not_configured");
  const oauth = (deps.oauthFor ?? oauthFor)(conn.provider as Provider);
  const adapter = (deps.adapterFor ?? adapterFor)(conn.provider as Provider);
  try {
    return await withProviderAuth(
      actor,
      conn,
      config,
      oauth,
      now,
      db,
      (token) => adapter.listCalendars(token),
    );
  } catch (error) {
    if (
      error instanceof OAuthGrantError ||
      (error instanceof ProviderHttpError &&
        (error.code === "unauthorized" || error.code === "insufficient_scope"))
    ) {
      await markReauth(
        actor,
        conn.id,
        conn.generation,
        error instanceof ProviderHttpError &&
          error.code === "insufficient_scope"
          ? MESSAGES.reauth_scope
          : MESSAGES.reauth,
        db,
      );
      throw new NativeConnectionNotReadyError("reauth");
    }
    throw error;
  }
}

async function links(
  db: D1Store,
  conn: D1ConnectionSecretRow,
): Promise<LinkRow[]> {
  return (
    await db
      .withSession("first-primary")
      .prepare(
        `SELECT id,event_id,external_id,external_etag,external_updated_at,synced_hash,all_day FROM "CalendarEventLink" WHERE connection_id=?1 AND family_id=?2 ORDER BY id`,
      )
      .bind(conn.id, conn.family_id)
      .all<LinkRow>()
  ).results;
}
async function eventsFor(
  db: D1Store,
  familyId: string,
  ids: string[],
): Promise<Map<string, EventRow>> {
  if (!ids.length) return new Map();
  const marks = ids.map((_, index) => `?${index + 2}`).join(",");
  const rows = (
    await db
      .withSession("first-primary")
      .prepare(
        `SELECT id,title,description,location,start_time,end_time,updated_at,source_connection_id,source_subscription_id,is_task FROM "Event" WHERE family_id=?1 AND id IN (${marks})`,
      )
      .bind(familyId, ...ids)
      .all<EventRow>()
  ).results;
  return new Map(rows.map((row) => [row.id, row]));
}

function inputFor(
  conn: D1ConnectionSecretRow,
  event: EventRow,
  link: LinkRow | null,
  timeZone: string,
) {
  const start = new Date(event.start_time),
    end = new Date(event.end_time);
  return {
    title: event.title,
    description: event.description,
    location: event.location,
    start,
    end,
    allDay: Boolean(link?.all_day) && isLocalMidnightSpan(start, end, timeZone),
    timeZone,
    marker: { connectionId: conn.id, eventId: event.id },
  };
}

async function deleteLinked(
  db: D1Store,
  conn: D1ConnectionSecretRow,
  link: LinkRow,
  event: EventRow | undefined,
  actor: CalendarConnectionActor,
  generation: number,
) {
  const session = db.withSession("first-primary");
  const result = await session.batch<{ id: string }>([
    session
      .prepare(
        `SELECT 1 AS admitted WHERE ${AUTH} AND EXISTS (SELECT 1 FROM "CalendarConnection" WHERE id=?5 AND family_id=?2 AND generation=?6)`,
      )
      .bind(...actorArgs(actor), conn.id, generation),
    session
      .prepare(
        `DELETE FROM "CalendarEventLink" WHERE id=?5 AND connection_id=?6 AND family_id=?2
         AND ${AUTH} AND EXISTS (SELECT 1 FROM "CalendarConnection" WHERE id=?6 AND family_id=?2 AND generation=?7)`,
      )
      .bind(...actorArgs(actor), link.id, conn.id, generation),
    ...(event
      ? [
          session
            .prepare(
              `DELETE FROM "Event" WHERE id=?5 AND family_id=?2 AND source_connection_id=?6
               AND ${AUTH} AND EXISTS (SELECT 1 FROM "CalendarConnection" WHERE id=?6 AND family_id=?2 AND generation=?7)`,
            )
            .bind(...actorArgs(actor), event.id, conn.id, generation),
        ]
      : []),
  ]);
  if (!result[0].results.length) throw new SupersededNativeSyncError();
}

async function applyRemote(
  db: D1Store,
  actor: CalendarConnectionActor,
  conn: D1ConnectionSecretRow,
  pulled: PullResult,
  window: { start: Date; end: Date },
  now: Date,
  timeZone: string,
  summary: SyncSummary,
) {
  const currentLinks = await links(db, conn);
  const byExternal = new Map(
    currentLinks.map((link) => [link.external_id, link]),
  );
  const eventMap = await eventsFor(
    db,
    conn.family_id,
    currentLinks
      .map((link) => link.event_id)
      .filter((id): id is string => Boolean(id)),
  );
  const remote = new Map<string, RemoteEvent>();
  for (const item of pulled.events) remote.set(item.id, item);
  for (const item of remote.values()) {
    const link = byExternal.get(item.id);
    const event = link?.event_id ? eventMap.get(link.event_id) : undefined;
    if (item.deleted) {
      if (!link) continue;
      await deleteLinked(db, conn, link, event, actor, conn.generation);
      byExternal.delete(item.id);
      if (event) summary.pulled.deleted++;
      continue;
    }
    if (link) {
      if (!event) continue;
      if (item.etag && item.etag === link.external_etag) continue;
      const incoming = remoteFields(item);
      const dirty = fieldsHash(localFields(event)) !== link.synced_hash;
      const remoteAt = item.updated?.getTime() ?? now.getTime();
      const localAt = event.updated_at;
      if (dirty && fieldsHash(localFields(event)) !== fieldsHash(incoming)) {
        summary.conflicts++;
        if (localAt >= remoteAt) {
          await db
            .withSession("first-primary")
            .prepare(
              `UPDATE "CalendarEventLink" SET external_etag=?7,external_updated_at=?8 WHERE id=?5 AND connection_id=?6 AND family_id=?2
               AND ${AUTH} AND EXISTS (SELECT 1 FROM "CalendarConnection" WHERE id=?6 AND family_id=?2 AND generation=?9)`,
            )
            .bind(
              ...actorArgs(actor),
              link.id,
              conn.id,
              item.etag,
              item.updated?.getTime() ?? null,
              conn.generation,
            )
            .run();
          continue;
        }
      }
      const hash = fieldsHash(incoming);
      const result = await db
        .withSession("first-primary")
        .batch([
          db
            .prepare(
              `SELECT 1 AS admitted WHERE ${AUTH} AND EXISTS (SELECT 1 FROM "CalendarConnection" WHERE id=?5 AND family_id=?2 AND generation=?6)`,
            )
            .bind(...actorArgs(actor), conn.id, conn.generation),
          db
            .prepare(
              `UPDATE "Event" SET title=?6,description=?7,location=?8,start_time=?9,end_time=?10,updated_at=?11 WHERE id=?5 AND family_id=?2
               AND ${AUTH} AND EXISTS (SELECT 1 FROM "CalendarConnection" c WHERE c.id=(SELECT e.source_connection_id FROM "Event" e WHERE e.id=?5 AND e.family_id=?2) AND c.family_id=?2 AND c.generation=?12)`,
            )
            .bind(
              ...actorArgs(actor),
              event.id,
              incoming.title,
              incoming.description,
              incoming.location,
              incoming.start_time.getTime(),
              incoming.end_time.getTime(),
              now.getTime(),
              conn.generation,
            ),
          db
            .prepare(
              `UPDATE "CalendarEventLink" SET external_etag=?7,external_updated_at=?8,synced_hash=?9,all_day=?10,synced_at=?11 WHERE id=?5 AND connection_id=?6 AND family_id=?2
               AND ${AUTH} AND EXISTS (SELECT 1 FROM "CalendarConnection" WHERE id=?6 AND family_id=?2 AND generation=?12)`,
            )
            .bind(
              ...actorArgs(actor),
              link.id,
              conn.id,
              item.etag,
              item.updated?.getTime() ?? null,
              hash,
              Number(item.allDay),
              now.getTime(),
              conn.generation,
            ),
        ]);
      if (!result[0].results.length) throw new SupersededNativeSyncError();
      if (fieldsHash(localFields(event)) !== hash) summary.pulled.updated++;
      continue;
    }
    if (item.marker?.connectionId === conn.id) {
      const own = await db
        .withSession("first-primary")
        .prepare(`SELECT id FROM "Event" WHERE id=?5 AND family_id=?2`)
        .bind(...actorArgs(actor), item.marker.eventId)
        .first<{ id: string }>();
      if (own) {
        const hash = fieldsHash(remoteFields(item));
        const inserted = await db
          .withSession("first-primary")
          .prepare(
            `INSERT OR IGNORE INTO "CalendarEventLink" (id,family_id,connection_id,event_id,external_id,external_etag,external_updated_at,synced_hash,all_day,synced_at)
             SELECT ?5,?2,?6,?7,?8,?9,?10,?11,?12,?13 WHERE ${AUTH}
             AND EXISTS (SELECT 1 FROM "CalendarConnection" WHERE id=?6 AND family_id=?2 AND generation=?14)`,
          )
          .bind(
            ...actorArgs(actor),
            randomUUID(),
            conn.id,
            own.id,
            item.id,
            item.etag,
            item.updated?.getTime() ?? null,
            hash,
            Number(item.allDay),
            now.getTime(),
            conn.generation,
          )
          .run();
        if (inserted.meta.changes) continue;
      }
    }
    if (
      item.end.getTime() < window.start.getTime() ||
      (!pulled.full && item.start.getTime() >= window.end.getTime())
    )
      continue;
    const incoming = remoteFields(item);
    const eventId = randomUUID();
    const linkId = randomUUID();
    const hash = fieldsHash(incoming);
    const result = await db
      .withSession("first-primary")
      .batch([
        db
          .prepare(
            `SELECT 1 AS admitted WHERE ${AUTH} AND EXISTS (SELECT 1 FROM "CalendarConnection" WHERE id=?5 AND family_id=?2 AND generation=?6)`,
          )
          .bind(...actorArgs(actor), conn.id, conn.generation),
        db
          .prepare(
            `INSERT INTO "Event" (id,family_id,title,description,location,start_time,end_time,event_type,created_by,source_connection_id,created_at,updated_at)
             SELECT ?5,?2,?6,?7,?8,?9,?10,'other',?1,?11,?12,?12 WHERE ${AUTH}
             AND EXISTS (SELECT 1 FROM "CalendarConnection" WHERE id=?11 AND family_id=?2 AND generation=?13)`,
          )
          .bind(
            ...actorArgs(actor),
            eventId,
            incoming.title,
            incoming.description,
            incoming.location,
            incoming.start_time.getTime(),
            incoming.end_time.getTime(),
            conn.id,
            now.getTime(),
            conn.generation,
          ),
        db
          .prepare(
            `INSERT OR IGNORE INTO "CalendarEventLink" (id,family_id,connection_id,event_id,external_id,external_etag,external_updated_at,synced_hash,all_day,synced_at)
             SELECT ?5,?2,?6,?7,?8,?9,?10,?11,?12,?13 WHERE ${AUTH}
             AND EXISTS (SELECT 1 FROM "CalendarConnection" WHERE id=?6 AND family_id=?2 AND generation=?14)`,
          )
          .bind(
            ...actorArgs(actor),
            linkId,
            conn.id,
            eventId,
            item.id,
            item.etag,
            item.updated?.getTime() ?? null,
            hash,
            Number(item.allDay),
            now.getTime(),
            conn.generation,
          ),
      ]);
    if (!result[0].results.length) throw new SupersededNativeSyncError();
    if (result[1].meta.changes) summary.pulled.created++;
  }
  if (pulled.full) {
    const seen = new Set(remote.keys());
    const freshLinks = await links(db, conn);
    const stale = freshLinks.filter((link) => !seen.has(link.external_id));
    const staleEvents = await eventsFor(
      db,
      conn.family_id,
      stale
        .map((link) => link.event_id)
        .filter((id): id is string => Boolean(id)),
    );
    for (const link of stale) {
      const event = link.event_id ? staleEvents.get(link.event_id) : undefined;
      if (
        event &&
        (event.start_time < window.start.getTime() ||
          event.start_time >= window.end.getTime())
      )
        continue;
      await deleteLinked(db, conn, link, event, actor, conn.generation);
      if (event) summary.pulled.deleted++;
    }
  }
}

async function pushLocal(
  db: D1Store,
  actor: CalendarConnectionActor,
  conn: D1ConnectionSecretRow,
  adapter: CalendarProviderAdapter,
  oauth: OAuthClient,
  config: ProviderConfig,
  now: Date,
  timeZone: string,
  window: { start: Date; end: Date },
  summary: SyncSummary,
) {
  if (!conn.calendar_id) return;
  let budget = MAX_PUSH_PER_RUN;
  const currentLinks = await links(db, conn);
  const eventMap = await eventsFor(
    db,
    conn.family_id,
    currentLinks
      .map((link) => link.event_id)
      .filter((id): id is string => Boolean(id)),
  );
  for (const link of currentLinks) {
    if (link.event_id || budget <= 0) continue;
    budget--;
    await withProviderAuth(actor, conn, config, oauth, now, db, (token) =>
      adapter.remove(token, conn.calendar_id!, link.external_id),
    );
    await db
      .withSession("first-primary")
      .prepare(
        `DELETE FROM "CalendarEventLink" WHERE id=?5 AND connection_id=?6 AND family_id=?2
         AND ${AUTH} AND EXISTS (SELECT 1 FROM "CalendarConnection" WHERE id=?6 AND family_id=?2 AND generation=?7)`,
      )
      .bind(...actorArgs(actor), link.id, conn.id, conn.generation)
      .run();
    summary.pushed.deleted++;
  }
  for (const link of currentLinks.filter((link) => link.event_id)) {
    const event = eventMap.get(link.event_id!);
    if (
      !event ||
      fieldsHash(localFields(event)) === link.synced_hash ||
      budget <= 0
    )
      continue;
    budget--;
    const input = inputFor(conn, event, link, timeZone);
    const result = await withProviderAuth(
      actor,
      conn,
      config,
      oauth,
      now,
      db,
      (token) =>
        adapter.update(token, conn.calendar_id!, link.external_id, input),
    );
    if (!result) {
      await deleteLinked(db, conn, link, event, actor, conn.generation);
      summary.pushed.deleted++;
      continue;
    }
    await db
      .withSession("first-primary")
      .prepare(
        `UPDATE "CalendarEventLink" SET external_etag=?7,external_updated_at=?8,synced_hash=?9,all_day=?10,synced_at=?11 WHERE id=?5 AND connection_id=?6 AND family_id=?2
         AND ${AUTH} AND EXISTS (SELECT 1 FROM "CalendarConnection" WHERE id=?6 AND family_id=?2 AND generation=?12)`,
      )
      .bind(
        ...actorArgs(actor),
        link.id,
        conn.id,
        result.etag,
        result.updated?.getTime() ?? null,
        fieldsHash(localFields(event)),
        Number(input.allDay),
        now.getTime(),
        conn.generation,
      )
      .run();
    summary.pushed.updated++;
  }
  if (conn.push_mode !== PUSH_MODES[1] || budget <= 0) return;
  const rows = (
    await db
      .withSession("first-primary")
      .prepare(
        `SELECT e.id,e.title,e.description,e.location,e.start_time,e.end_time,e.updated_at,e.source_connection_id,e.source_subscription_id,e.is_task FROM "Event" e
    WHERE e.family_id=?2 AND e.source_subscription_id IS NULL AND e.source_connection_id IS NULL AND e.is_task=0 AND e.start_time>=?5 AND e.start_time<?6
    AND NOT EXISTS (SELECT 1 FROM "CalendarEventLink" l WHERE l.connection_id=?7 AND l.event_id=e.id) ORDER BY e.start_time,e.id LIMIT ?8`,
      )
      .bind(
        ...actorArgs(actor),
        now.getTime() - DAY_MS,
        window.end.getTime(),
        conn.id,
        budget,
      )
      .all<EventRow>()
  ).results;
  for (const event of rows) {
    if (budget <= 0) break;
    budget--;
    const input = inputFor(conn, event, null, timeZone);
    const result = await withProviderAuth(
      actor,
      conn,
      config,
      oauth,
      now,
      db,
      (token) => adapter.create(token, conn.calendar_id!, input),
    );
    const inserted = await db
      .withSession("first-primary")
      .prepare(
        `INSERT OR IGNORE INTO "CalendarEventLink" (id,family_id,connection_id,event_id,external_id,external_etag,external_updated_at,synced_hash,all_day,synced_at)
         SELECT ?5,?2,?6,?7,?8,?9,?10,?11,?12,?13 WHERE ${AUTH}
         AND EXISTS (SELECT 1 FROM "CalendarConnection" WHERE id=?6 AND family_id=?2 AND generation=?14)`,
      )
      .bind(
        ...actorArgs(actor),
        randomUUID(),
        conn.id,
        event.id,
        result.id,
        result.etag,
        result.updated?.getTime() ?? null,
        fieldsHash(localFields(event)),
        Number(input.allDay),
        now.getTime(),
        conn.generation,
      )
      .run();
    if (inserted.meta.changes) summary.pushed.created++;
  }
}

export async function syncD1CalendarConnection(
  actor: CalendarConnectionActor,
  connectionId: string,
  deps: NativeSyncDeps = {},
): Promise<SyncSummary | null> {
  const db = deps.database ?? (await getD1Database());
  const now = deps.now ?? new Date();
  const timeZone = deps.timeZone ?? DEFAULT_FAMILY_TIMEZONE;
  const conn = await readConnection(actor, connectionId, db);
  if (!conn) return null;
  const summary: SyncSummary = {
    status: "ok",
    pulled: zero(),
    pushed: zero(),
    conflicts: 0,
    resynced: false,
  };
  const finish = async (
    status: SyncSummary["status"],
    code: string | null,
  ): Promise<SyncSummary> => {
    const message = code ? (MESSAGES[code] ?? MESSAGES.unknown) : null;
    await db
      .withSession("first-primary")
      .prepare(
        `UPDATE "CalendarConnection" SET last_synced_at=?5,status=?6,last_error=?7,access_token_enc=CASE WHEN ?8=1 THEN NULL ELSE access_token_enc END,conflicts_count=conflicts_count+?9,last_conflict_at=CASE WHEN ?9>0 THEN ?5 ELSE last_conflict_at END,updated_at=?5
      WHERE id=?10 AND family_id=?2 AND generation=?11`,
      )
      .bind(
        ...actorArgs(actor),
        now.getTime(),
        status === "not_ready" ? "pending" : status,
        message,
        Number(status === "reauth_required"),
        summary.conflicts,
        conn.id,
        conn.generation,
      )
      .run();
    if (code)
      console.warn("[calendar-sync] sync failed", {
        connectionId: conn.id,
        code,
      });
    return { ...summary, status, ...(message ? { error: message } : {}) };
  };
  if (!conn.calendar_id) return { ...summary, status: "not_ready" };
  if (!isProvider(conn.provider)) return finish("error", "not_configured");
  const config = (deps.configFor ?? getProviderConfig)(
    conn.provider as Provider,
  );
  if (!config) return finish("error", "not_configured");
  const adapter = (deps.adapterFor ?? adapterFor)(conn.provider as Provider);
  const oauth = (deps.oauthFor ?? oauthFor)(conn.provider as Provider);
  const window = importWindow(now);
  try {
    let pulled: PullResult;
    let cursor = usableCursor(conn.sync_cursor, now);
    let issuedAt = cursor ? (cursorIssuedAt(conn.sync_cursor) ?? now) : now;
    try {
      pulled = await withProviderAuth(
        actor,
        conn,
        config,
        oauth,
        now,
        db,
        (token) =>
          adapter.pull(token, conn.calendar_id!, cursor, window, timeZone),
      );
    } catch (error) {
      if (!(error instanceof CursorExpiredError)) throw error;
      summary.resynced = true;
      cursor = null;
      issuedAt = now;
      pulled = await withProviderAuth(
        actor,
        conn,
        config,
        oauth,
        now,
        db,
        (token) =>
          adapter.pull(token, conn.calendar_id!, null, window, timeZone),
      );
    }
    await applyRemote(db, actor, conn, pulled, window, now, timeZone, summary);
    const cursorWritten = await db
      .withSession("first-primary")
      .prepare(
        `UPDATE "CalendarConnection" SET sync_cursor=?6,updated_at=?7 WHERE id=?5 AND family_id=?2 AND generation=?8 RETURNING id`,
      )
      .bind(
        ...actorArgs(actor),
        conn.id,
        packCursor(pulled.nextCursor, issuedAt),
        now.getTime(),
        conn.generation,
      )
      .all<{ id: string }>();
    if (!cursorWritten.results.length) throw new SupersededNativeSyncError();
    await pushLocal(
      db,
      actor,
      conn,
      adapter,
      oauth,
      config,
      now,
      timeZone,
      window,
      summary,
    );
  } catch (error) {
    if (error instanceof SupersededNativeSyncError)
      return { ...summary, status: "superseded" };
    if (error instanceof OAuthGrantError)
      return finish("reauth_required", "reauth");
    if (error instanceof ProviderHttpError && error.code === "unauthorized")
      return finish("reauth_required", "reauth");
    if (
      error instanceof ProviderHttpError &&
      error.code === "insufficient_scope"
    )
      return finish("reauth_required", "reauth_scope");
    return finish("error", errorCode(error));
  }
  return finish("ok", null);
}

const inFlight = new Map<string, Promise<SyncSummary | null>>();
export function syncD1CalendarConnectionExclusive(
  actor: CalendarConnectionActor,
  connectionId: string,
  deps: NativeSyncDeps = {},
) {
  const key = `${actor.familyId}:${connectionId}`;
  const existing = inFlight.get(key);
  if (existing) return existing;
  const run = syncD1CalendarConnection(actor, connectionId, deps).finally(() =>
    inFlight.delete(key),
  );
  inFlight.set(key, run);
  return run;
}
