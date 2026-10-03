// Two-way sync engine for Google / Microsoft calendar connections (#264).
//
// One run = refresh token if needed -> pull (incremental via cursor, full on
// first run or after 410) -> apply remote changes -> push local changes.
// Every statement is scoped by family_id and connection id. Local rows are
// matched to provider events through CalendarEventLink, whose unique keys make
// re-running a sync a no-op (no duplicate rows). See
// docs/architecture/CALENDAR_SYNC.md for the full semantics.

import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit-db";
import { DEFAULT_FAMILY_TIMEZONE } from "@/lib/calendar-import/timezone";
import { importWindow } from "@/lib/calendar-import/sync";
import {
  getProviderConfig,
  isProvider,
  PROVIDER_LABELS,
  type Provider,
  type ProviderConfig,
} from "./config";
import { ProviderHttpError } from "./http";
import {
  fieldsHash,
  isLocalMidnightSpan,
  type SyncedFields,
} from "./mapping";
import { adapterFor, oauthFor } from "./providers";
import {
  decryptToken,
  encryptToken,
  needsReencrypt,
  tokenAad,
} from "./token-crypto";
import {
  CursorExpiredError,
  OAuthGrantError,
  type CalendarProviderAdapter,
  type EventInput,
  type OAuthClient,
  type PullResult,
  type RemoteCalendar,
  type RemoteEvent,
} from "./types";

export const OPPORTUNISTIC_SYNC_MS = 5 * 60 * 1000;
export const MAX_PUSH_PER_RUN = 100;
export const MAX_CONNECTIONS_PER_FAMILY = 6;
export const PUSH_MODES = ["linked", "all"] as const;
export type PushMode = (typeof PUSH_MODES)[number];
const DAY_MS = 24 * 60 * 60 * 1000;
const TOKEN_SKEW_MS = 60 * 1000;
/**
 * A stored cursor older than this is dropped and the window is listed in full
 * again. Graph's calendarView delta only ever reports changes inside the
 * window it was started with, and Google's sync token follows the first
 * listing too, so without this the sync window would stay frozen at the first
 * sync and events further out than 180 days from then would never arrive.
 */
export const CURSOR_MAX_AGE_MS = 7 * DAY_MS;

// Stored cursor format: "c1.<issued ms>.<provider cursor>". The prefix is
// internal; adapters only ever see the provider cursor. A value without it
// (written before this format) counts as expired: one full listing, which is
// idempotent.
const CURSOR_RE = /^c1\.(\d{1,15})\.([\s\S]+)$/;

export function packCursor(cursor: string | null, issuedAt: Date): string | null {
  return cursor ? `c1.${issuedAt.getTime()}.${cursor}` : null;
}

/** The provider cursor to resume from, or null when a full listing is due. */
export function usableCursor(stored: string | null | undefined, now: Date): string | null {
  if (!stored) return null;
  const m = CURSOR_RE.exec(stored);
  if (!m) return null;
  const age = now.getTime() - Number(m[1]);
  if (age < 0 || age > CURSOR_MAX_AGE_MS) return null;
  return m[2];
}

export interface EngineDeps {
  db?: any;
  now?: Date;
  timeZone?: string;
  adapterFor?: (provider: Provider) => CalendarProviderAdapter;
  oauthFor?: (provider: Provider) => OAuthClient;
  configFor?: (provider: Provider) => ProviderConfig | null;
}

export interface SyncCounts {
  created: number;
  updated: number;
  deleted: number;
}

export interface SyncSummary {
  status: "ok" | "error" | "reauth_required" | "not_ready" | "superseded";
  pulled: SyncCounts;
  pushed: SyncCounts;
  conflicts: number;
  resynced: boolean;
  error?: string;
}

const zero = (): SyncCounts => ({ created: 0, updated: 0, deleted: 0 });

const CONN_SELECT = {
  id: true,
  family_id: true,
  user_id: true,
  provider: true,
  calendar_id: true,
  access_token_enc: true,
  refresh_token_enc: true,
  token_expires_at: true,
  sync_cursor: true,
  push_mode: true,
  generation: true,
} as const;

const EVENT_SELECT = {
  id: true,
  title: true,
  description: true,
  location: true,
  start_time: true,
  end_time: true,
  updated_at: true,
  source_connection_id: true,
} as const;

type LocalEvent = SyncedFields & {
  id: string;
  updated_at: Date | null;
  source_connection_id: string | null;
};

type Link = {
  id: string;
  event_id: string | null;
  external_id: string;
  external_etag: string | null;
  synced_hash: string | null;
  all_day: boolean;
};

// Fixed-vocabulary, content-free messages shown to parents.
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

function errorCode(err: unknown): string {
  if (err instanceof ProviderHttpError) {
    if (err.code === "http" && (err.status === 403 || err.status === 404))
      return "calendar_gone";
    if (err.code in MESSAGES) return err.code;
  }
  return "unknown";
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "P2002";
}

function remoteFields(r: RemoteEvent): SyncedFields {
  return {
    title: r.title,
    description: r.description,
    location: r.location,
    start_time: r.start,
    end_time: r.end,
  };
}

function sameFields(a: SyncedFields, b: SyncedFields): boolean {
  return fieldsHash(a) === fieldsHash(b);
}

/** Client-facing shape. Never includes tokens, cursors or event content. */
export interface ConnectionDto {
  id: string;
  provider: string;
  provider_label: string;
  calendar_id: string | null;
  calendar_name: string | null;
  push_mode: string;
  status: string;
  last_synced_at: string | null;
  last_error: string | null;
  conflicts_count: number;
  last_conflict_at: string | null;
  owner: { id: string; name: string };
  is_mine: boolean;
}

export const CONNECTION_DTO_SELECT = {
  id: true,
  provider: true,
  calendar_id: true,
  calendar_name: true,
  push_mode: true,
  status: true,
  last_synced_at: true,
  last_error: true,
  conflicts_count: true,
  last_conflict_at: true,
  user_id: true,
  user: { select: { id: true, name: true } },
} as const;

export function toConnectionDto(c: any, viewerId: string): ConnectionDto {
  const iso = (d: Date | null | undefined) =>
    d ? new Date(d).toISOString() : null;
  return {
    id: c.id,
    provider: c.provider,
    provider_label: isProvider(c.provider)
      ? PROVIDER_LABELS[c.provider as Provider]
      : c.provider,
    calendar_id: c.calendar_id ?? null,
    calendar_name: c.calendar_name ?? null,
    push_mode: c.push_mode ?? "linked",
    status: c.status ?? "pending",
    last_synced_at: iso(c.last_synced_at),
    last_error: c.last_error ?? null,
    conflicts_count: c.conflicts_count ?? 0,
    last_conflict_at: iso(c.last_conflict_at),
    owner: { id: c.user?.id ?? c.user_id, name: c.user?.name ?? "Member" },
    is_mine: c.user_id === viewerId,
  };
}

function logFailure(connectionId: string, code: string) {
  // ids and a fixed code only: never tokens, URLs, titles or provider bodies
  console.warn("[calendar-sync] sync failed", { connectionId, code });
}

interface Ctx {
  db: any;
  now: Date;
  timeZone: string;
  conn: any;
  config: ProviderConfig;
  adapter: CalendarProviderAdapter;
  oauth: OAuthClient;
}

async function accessToken(ctx: Ctx, force = false): Promise<string> {
  const { conn, db, now } = ctx;
  if (!force) {
    const current = decryptToken(
      conn.access_token_enc,
      tokenAad.access(conn.family_id),
    );
    const expires = conn.token_expires_at
      ? new Date(conn.token_expires_at).getTime()
      : 0;
    if (current && expires - TOKEN_SKEW_MS > now.getTime()) return current;
  }
  const refresh = decryptToken(
    conn.refresh_token_enc,
    tokenAad.refresh(conn.family_id),
  );
  if (!refresh) throw new OAuthGrantError();
  const set = await ctx.oauth.refresh(ctx.config, refresh);
  const data: Record<string, unknown> = {
    access_token_enc: encryptToken(
      set.accessToken,
      tokenAad.access(conn.family_id),
    ),
    token_expires_at: set.expiresAt,
  };
  // Microsoft rotates refresh tokens; Google usually does not return one.
  // Key rotation: an unchanged refresh token is re-encrypted with the current key.
  if (set.refreshToken || needsReencrypt(conn.refresh_token_enc))
    data.refresh_token_enc = encryptToken(
      set.refreshToken ?? refresh,
      tokenAad.refresh(conn.family_id),
    );
  const written = await db.calendarConnection.updateMany({
    where: { id: conn.id, family_id: conn.family_id },
    data,
  });
  if (written.count === 0) {
    // The connection was removed while the refresh ran (disconnect, or account
    // or household deletion, which row-locks connections before reading their
    // tokens, so this write waits for it and then matches nothing). The
    // provider has just issued a token no row holds: revoke it, best effort,
    // so the grant does not outlive its record, then stop this run.
    try {
      await ctx.oauth.revoke(ctx.config, set.refreshToken ?? set.accessToken);
    } catch {
      console.warn("[calendar-sync] revoke of orphaned token failed", {
        connectionId: conn.id,
      });
    }
    throw new OAuthGrantError();
  }
  Object.assign(conn, data);
  return set.accessToken;
}

async function withAuth<T>(
  ctx: Ctx,
  fn: (token: string) => Promise<T>,
): Promise<T> {
  const token = await accessToken(ctx);
  try {
    return await fn(token);
  } catch (err) {
    if (err instanceof ProviderHttpError && err.code === "unauthorized") {
      return fn(await accessToken(ctx, true));
    }
    throw err;
  }
}

function inputFor(ctx: Ctx, ev: LocalEvent, link: Link | null): EventInput {
  const start = new Date(ev.start_time);
  const end = new Date(ev.end_time);
  return {
    title: ev.title,
    description: ev.description ?? null,
    location: ev.location ?? null,
    start,
    end,
    allDay:
      Boolean(link?.all_day) && isLocalMidnightSpan(start, end, ctx.timeZone),
    timeZone: ctx.timeZone,
    marker: { connectionId: ctx.conn.id, eventId: ev.id },
  };
}

async function loadLinks(ctx: Ctx): Promise<Link[]> {
  return ctx.db.calendarEventLink.findMany({
    where: { connection_id: ctx.conn.id, family_id: ctx.conn.family_id },
    select: {
      id: true,
      event_id: true,
      external_id: true,
      external_etag: true,
      synced_hash: true,
      all_day: true,
    },
  });
}

async function loadEvents(
  ctx: Ctx,
  ids: string[],
): Promise<Map<string, LocalEvent>> {
  const out = new Map<string, LocalEvent>();
  if (ids.length === 0) return out;
  const rows: LocalEvent[] = await ctx.db.event.findMany({
    where: { family_id: ctx.conn.family_id, id: { in: ids } },
    select: EVENT_SELECT,
  });
  for (const r of rows) out.set(r.id, r);
  return out;
}

/**
 * The connection was re-pointed (calendar change, reconnect) or removed while
 * this run was in flight. The run stops without writing anything more.
 */
export class SupersededRunError extends Error {
  constructor() {
    super("Calendar connection changed during sync");
    this.name = "SupersededRunError";
  }
}

/**
 * Run `fn` in a transaction that first locks the connection row, but only if
 * it still has the generation this run started with. changeCalendar and a
 * reconnect bump the generation under the same row lock, so a stale run can
 * never insert events/links or save a cursor for the previous calendar: it
 * either commits before the switch (whose cleanup then removes its rows) or
 * sees the new generation and aborts.
 */
async function inGeneration<T>(ctx: Ctx, fn: (tx: any) => Promise<T>): Promise<T> {
  const { conn } = ctx;
  return ctx.db.$transaction(async (tx: any) => {
    // A no-op UPDATE takes the row lock and tells us whether we still own it.
    const held = await tx.calendarConnection.updateMany({
      where: { id: conn.id, family_id: conn.family_id, generation: conn.generation },
      data: { generation: conn.generation },
    });
    if (held.count !== 1) throw new SupersededRunError();
    return fn(tx);
  });
}

async function deleteLocal(ctx: Ctx, link: Link, eventId: string | null) {
  const { db, conn } = ctx;
  await db.$transaction(async (tx: any) => {
    await tx.calendarEventLink.deleteMany({
      where: { id: link.id, connection_id: conn.id, family_id: conn.family_id },
    });
    if (eventId) {
      await tx.event.deleteMany({
        where: { id: eventId, family_id: conn.family_id },
      });
    }
  });
}

/** Apply pulled provider changes to local rows. */
async function applyRemote(
  ctx: Ctx,
  pulled: PullResult,
  window: { start: Date; end: Date },
  summary: SyncSummary,
) {
  const { db, conn, now } = ctx;
  const links = await loadLinks(ctx);
  const byExternal = new Map(links.map((l) => [l.external_id, l]));
  const linkedEventIds = new Set(
    links.map((l) => l.event_id).filter((id): id is string => Boolean(id)),
  );
  const events = await loadEvents(ctx, [...linkedEventIds]);

  // A delta can repeat an id; the last entry is the current state.
  const remote = new Map<string, RemoteEvent>();
  for (const r of pulled.events) remote.set(r.id, r);

  for (const r of remote.values()) {
    const link = byExternal.get(r.id);
    const ev = link?.event_id ? events.get(link.event_id) : undefined;

    if (r.deleted) {
      if (!link) continue;
      if (ev && fieldsHash(ev) !== link.synced_hash) summary.conflicts++; // remote delete wins
      await deleteLocal(ctx, link, ev?.id ?? null);
      byExternal.delete(r.id);
      if (ev) summary.pulled.deleted++;
      continue;
    }

    if (link) {
      if (!ev) {
        // Deleted locally (tombstone); the local delete wins and is pushed below.
        if (link.external_etag !== r.etag) summary.conflicts++;
        continue;
      }
      if (r.etag && link.external_etag === r.etag) continue; // unchanged remotely
      const incoming = remoteFields(r);
      const localDirty = fieldsHash(ev) !== link.synced_hash;
      if (localDirty && !sameFields(ev, incoming)) {
        summary.conflicts++;
        const remoteAt = r.updated?.getTime() ?? now.getTime();
        const localAt = ev.updated_at ? new Date(ev.updated_at).getTime() : 0;
        if (localAt >= remoteAt) {
          // Local wins (last writer): acknowledge the remote version, keep
          // synced_hash stale so the push step sends the local fields.
          await db.calendarEventLink.updateMany({
            where: { id: link.id, connection_id: conn.id },
            data: { external_etag: r.etag, external_updated_at: r.updated },
          });
          link.external_etag = r.etag;
          continue;
        }
      }
      const hash = fieldsHash(incoming);
      await db.$transaction(async (tx: any) => {
        if (!sameFields(ev, incoming)) {
          await tx.event.updateMany({
            where: { id: ev.id, family_id: conn.family_id },
            data: incoming,
          });
        }
        await tx.calendarEventLink.updateMany({
          where: { id: link.id, connection_id: conn.id },
          data: {
            external_etag: r.etag,
            external_updated_at: r.updated,
            synced_hash: hash,
            all_day: r.allDay,
            synced_at: now,
          },
        });
      });
      if (!sameFields(ev, incoming)) summary.pulled.updated++;
      Object.assign(ev, incoming);
      Object.assign(link, {
        external_etag: r.etag,
        synced_hash: hash,
        all_day: r.allDay,
      });
      continue;
    }

    // No link yet. An event this app pushed (crash before the link write)
    // carries our marker: re-link it instead of importing a duplicate.
    if (r.marker && r.marker.connectionId === conn.id) {
      const own = await db.event.findFirst({
        where: { id: r.marker.eventId, family_id: conn.family_id },
        select: { id: true },
      });
      if (own && !linkedEventIds.has(own.id)) {
        try {
          await inGeneration(ctx, (tx) =>
            tx.calendarEventLink.create({
            data: {
              family_id: conn.family_id,
              connection_id: conn.id,
              event_id: own.id,
              external_id: r.id,
              external_etag: r.etag,
              external_updated_at: r.updated,
              synced_hash: fieldsHash(remoteFields(r)),
              all_day: r.allDay,
              synced_at: now,
            },
            }),
          );
          linkedEventIds.add(own.id);
        } catch (err) {
          if (!isUniqueViolation(err)) throw err;
        }
        continue;
      }
    }

    if (r.end.getTime() < window.start.getTime()) continue; // history, not imported
    // An incremental pull can carry events far beyond the window (Google
    // expands a new endless series into many instances). They are imported by
    // the periodic full listing once they come inside the window.
    if (!pulled.full && r.start.getTime() >= window.end.getTime()) continue;
    const incoming = remoteFields(r);
    try {
      await inGeneration(ctx, async (tx: any) => {
        const created = await tx.event.create({
          data: {
            ...incoming,
            family_id: conn.family_id,
            event_type: "other",
            created_by: conn.user_id,
            source_connection_id: conn.id,
          },
          select: { id: true },
        });
        await tx.calendarEventLink.create({
          data: {
            family_id: conn.family_id,
            connection_id: conn.id,
            event_id: created.id,
            external_id: r.id,
            external_etag: r.etag,
            external_updated_at: r.updated,
            synced_hash: fieldsHash(incoming),
            all_day: r.allDay,
            synced_at: now,
          },
        });
      });
      summary.pulled.created++;
    } catch (err) {
      // A concurrent run linked it first; the transaction rolled back.
      if (!isUniqueViolation(err)) throw err;
    }
  }

  // A full listing is authoritative inside the window: linked events the
  // provider no longer returns were deleted there.
  if (pulled.full) {
    const seen = new Set(remote.keys());
    const remaining = await loadLinks(ctx);
    const stale = remaining.filter((l) => !seen.has(l.external_id));
    const staleEvents = await loadEvents(
      ctx,
      stale.map((l) => l.event_id).filter((id): id is string => Boolean(id)),
    );
    for (const link of stale) {
      const ev = link.event_id ? staleEvents.get(link.event_id) : undefined;
      if (ev) {
        const start = new Date(ev.start_time).getTime();
        if (start < window.start.getTime() || start >= window.end.getTime())
          continue;
      }
      await deleteLocal(ctx, link, ev?.id ?? null);
      if (ev) summary.pulled.deleted++;
    }
  }
}

/** Push local deletes, edits and (push_mode 'all') new family events. */
async function pushLocal(
  ctx: Ctx,
  window: { start: Date; end: Date },
  summary: SyncSummary,
) {
  const { db, conn, now, adapter } = ctx;
  const calendarId = conn.calendar_id as string;
  let budget = MAX_PUSH_PER_RUN;
  const links = await loadLinks(ctx);

  // 1. Local deletes: tombstone links (event_id set NULL by the FK).
  for (const link of links) {
    if (link.event_id || budget <= 0) continue;
    budget--;
    await withAuth(ctx, (t) => adapter.remove(t, calendarId, link.external_id));
    await db.calendarEventLink.deleteMany({
      where: { id: link.id, connection_id: conn.id, family_id: conn.family_id },
    });
    summary.pushed.deleted++;
  }

  // 2. Local edits to linked events.
  const live = links.filter((l) => l.event_id);
  const events = await loadEvents(
    ctx,
    live.map((l) => l.event_id as string),
  );
  for (const link of live) {
    const ev = events.get(link.event_id as string);
    if (!ev || fieldsHash(ev) === link.synced_hash) continue;
    if (budget <= 0) break;
    budget--;
    const input = inputFor(ctx, ev, link);
    const res = await withAuth(ctx, (t) =>
      adapter.update(t, calendarId, link.external_id, input),
    );
    if (!res) {
      // Gone at the provider. An event imported from it goes too; a local
      // event just loses its link.
      await deleteLocal(
        ctx,
        link,
        ev.source_connection_id === conn.id ? ev.id : null,
      );
      if (ev.source_connection_id === conn.id) summary.pulled.deleted++;
      continue;
    }
    await db.calendarEventLink.updateMany({
      where: { id: link.id, connection_id: conn.id },
      data: {
        external_etag: res.etag,
        external_updated_at: res.updated,
        synced_hash: fieldsHash(ev),
        all_day: input.allDay,
        synced_at: now,
      },
    });
    summary.pushed.updated++;
  }

  // 3. New local family events, only when the owner opted in.
  if (conn.push_mode !== "all" || budget <= 0) return;
  // Already-linked events are excluded in the query itself (not after a
  // limit), so a household with more eligible events than one run's budget
  // makes progress on every run instead of re-reading the same first page.
  const candidates: LocalEvent[] = await db.event.findMany({
    where: {
      family_id: conn.family_id,
      source_subscription_id: null,
      source_connection_id: null,
      is_task: false,
      start_time: { gte: new Date(now.getTime() - DAY_MS), lt: window.end },
      sync_links: { none: { connection_id: conn.id } },
    },
    select: EVENT_SELECT,
    orderBy: [{ start_time: "asc" }, { id: "asc" }],
    take: budget,
  });
  for (const ev of candidates) {
    if (budget <= 0) break;
    budget--;
    const input = inputFor(ctx, ev, null);
    const res = await withAuth(ctx, (t) => adapter.create(t, calendarId, input));
    try {
      await inGeneration(ctx, (tx) =>
        tx.calendarEventLink.create({
        data: {
          family_id: conn.family_id,
          connection_id: conn.id,
          event_id: ev.id,
          external_id: res.id,
          external_etag: res.etag,
          external_updated_at: res.updated,
          synced_hash: fieldsHash(ev),
          all_day: false,
          synced_at: now,
        },
        }),
      );
      summary.pushed.created++;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
  }
}

/**
 * Run one sync for a connection. Returns null when the connection does not
 * exist in `familyId` (callers answer 404).
 */
export async function syncConnection(
  connectionId: string,
  familyId: string,
  deps: EngineDeps = {},
): Promise<SyncSummary | null> {
  const db = deps.db ?? prisma;
  const now = deps.now ?? new Date();
  const conn = await db.calendarConnection.findFirst({
    where: { id: connectionId, family_id: familyId },
    select: CONN_SELECT,
  });
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
    const data: Record<string, unknown> = {
      last_synced_at: now,
      status: status === "not_ready" ? "pending" : status,
      last_error: code ? MESSAGES[code] ?? MESSAGES.unknown : null,
    };
    if (summary.conflicts > 0) {
      data.conflicts_count = { increment: summary.conflicts };
      data.last_conflict_at = now;
    }
    if (status === "reauth_required") data.access_token_enc = null;
    // Only the run's own generation: a stale run must not overwrite the status
    // of the calendar the member switched to.
    await db.calendarConnection.updateMany({
      where: { id: conn.id, family_id: familyId, generation: conn.generation },
      data,
    });
    if (code) logFailure(conn.id, code);
    return {
      ...summary,
      status,
      ...(code ? { error: MESSAGES[code] ?? MESSAGES.unknown } : {}),
    };
  };

  if (!conn.calendar_id) return { ...summary, status: "not_ready" };
  if (!isProvider(conn.provider)) return finish("error", "not_configured");
  const config = (deps.configFor ?? getProviderConfig)(conn.provider);
  if (!config) return finish("error", "not_configured");

  const ctx: Ctx = {
    db,
    now,
    timeZone: deps.timeZone ?? DEFAULT_FAMILY_TIMEZONE,
    conn,
    config,
    adapter: (deps.adapterFor ?? ((p) => adapterFor(p)))(conn.provider),
    oauth: (deps.oauthFor ?? ((p) => oauthFor(p)))(conn.provider),
  };
  const window = importWindow(now);

  try {
    let pulled: PullResult;
    const cursor = usableCursor(conn.sync_cursor, now);
    // A periodic full listing (cursor too old) is a routine refresh, not a
    // 410 resync, so `resynced` stays false for it.
    try {
      pulled = await withAuth(ctx, (t) =>
        ctx.adapter.pull(t, conn.calendar_id, cursor, window, ctx.timeZone),
      );
    } catch (err) {
      if (!(err instanceof CursorExpiredError)) throw err;
      summary.resynced = true;
      pulled = await withAuth(ctx, (t) =>
        ctx.adapter.pull(t, conn.calendar_id, null, window, ctx.timeZone),
      );
    }
    await applyRemote(ctx, pulled, window, summary);
    // Save the cursor before pushing, so a push failure does not replay the
    // pull. Conditional on the generation: never restore an old calendar's cursor.
    await inGeneration(ctx, (tx) =>
      tx.calendarConnection.updateMany({
        where: { id: conn.id, family_id: familyId, generation: conn.generation },
        data: { sync_cursor: packCursor(pulled.nextCursor, now) },
      }),
    );
    await pushLocal(ctx, window, summary);
  } catch (err) {
    if (err instanceof SupersededRunError) {
      console.warn("[calendar-sync] run superseded", { connectionId: conn.id });
      return { ...summary, status: "superseded" };
    }
    if (err instanceof OAuthGrantError) return finish("reauth_required", "reauth");
    if (err instanceof ProviderHttpError && err.code === "unauthorized")
      return finish("reauth_required", "reauth");
    if (err instanceof ProviderHttpError && err.code === "insufficient_scope")
      return finish("reauth_required", "reauth_scope");
    return finish("error", errorCode(err));
  }
  return finish("ok", null);
}

const inFlight = new Map<string, Promise<SyncSummary | null>>();

/** One sync per connection per process at a time; concurrent callers share it. */
export function syncConnectionExclusive(
  connectionId: string,
  familyId: string,
  deps: EngineDeps = {},
): Promise<SyncSummary | null> {
  const existing = inFlight.get(connectionId);
  if (existing) return existing;
  const run = syncConnection(connectionId, familyId, deps).finally(() =>
    inFlight.delete(connectionId),
  );
  inFlight.set(connectionId, run);
  return run;
}

/**
 * Opportunistic sync when the calendar page loads (no scheduler, AGENTS.md).
 * Syncs this family's ready connections not synced in the last 5 minutes. A
 * DB-backed rate-limit window per connection acts as a cross-replica lease.
 */
export async function refreshStaleConnections(
  familyId: string,
  deps: EngineDeps = {},
): Promise<number> {
  const db = deps.db ?? prisma;
  const now = deps.now ?? new Date();
  const configFor = deps.configFor ?? getProviderConfig;
  let synced = 0;
  try {
    const stale: Array<{ id: string; provider: string }> =
      await db.calendarConnection.findMany({
        where: {
          family_id: familyId,
          calendar_id: { not: null },
          status: { not: "reauth_required" },
          OR: [
            { last_synced_at: null },
            {
              last_synced_at: {
                lt: new Date(now.getTime() - OPPORTUNISTIC_SYNC_MS),
              },
            },
          ],
        },
        select: { id: true, provider: true },
        orderBy: { last_synced_at: "asc" },
        take: MAX_CONNECTIONS_PER_FAMILY,
      });
    for (const { id, provider } of stale) {
      if (!isProvider(provider) || !configFor(provider)) continue;
      const lease = await checkRateLimit(
        `calsync-auto:${id}`,
        1,
        OPPORTUNISTIC_SYNC_MS,
      );
      if (!lease.allowed) continue;
      await syncConnectionExclusive(id, familyId, deps);
      synced++;
    }
  } catch {
    console.warn("[calendar-sync] background sync failed", { familyId });
  }
  return synced;
}

export class ConnectionNotReadyError extends Error {
  constructor(readonly reason: "not_configured" | "reauth") {
    super(`Calendar connection not usable (${reason})`);
    this.name = "ConnectionNotReadyError";
  }
}

/**
 * The provider calendars the connecting member can choose from. Refreshes the
 * access token when needed. Null when the connection is not in `familyId`.
 * Throws ConnectionNotReadyError when the grant is gone (status is set to
 * reauth_required) or the provider is not configured.
 */
export async function listConnectionCalendars(
  connectionId: string,
  familyId: string,
  deps: EngineDeps = {},
): Promise<RemoteCalendar[] | null> {
  const db = deps.db ?? prisma;
  const conn = await db.calendarConnection.findFirst({
    where: { id: connectionId, family_id: familyId },
    select: CONN_SELECT,
  });
  if (!conn) return null;
  if (!isProvider(conn.provider))
    throw new ConnectionNotReadyError("not_configured");
  const config = (deps.configFor ?? getProviderConfig)(conn.provider);
  if (!config) throw new ConnectionNotReadyError("not_configured");
  const ctx: Ctx = {
    db,
    now: deps.now ?? new Date(),
    timeZone: deps.timeZone ?? DEFAULT_FAMILY_TIMEZONE,
    conn,
    config,
    adapter: (deps.adapterFor ?? ((p) => adapterFor(p)))(conn.provider),
    oauth: (deps.oauthFor ?? ((p) => oauthFor(p)))(conn.provider),
  };
  try {
    return await withAuth(ctx, (t) => ctx.adapter.listCalendars(t));
  } catch (err) {
    if (
      err instanceof OAuthGrantError ||
      (err instanceof ProviderHttpError &&
        (err.code === "unauthorized" || err.code === "insufficient_scope"))
    ) {
      await db.calendarConnection.updateMany({
        where: { id: conn.id, family_id: familyId },
        data: {
          status: "reauth_required",
          last_error:
            err instanceof ProviderHttpError && err.code === "insufficient_scope"
              ? MESSAGES.reauth_scope
              : MESSAGES.reauth,
          access_token_enc: null,
        },
      });
      throw new ConnectionNotReadyError("reauth");
    }
    throw err;
  }
}

/** Remove events imported from this connection and all its links. */
/**
 * Delete a connection's links and the events imported through it (not the
 * connection row). Exported for account deletion, which runs it inside its
 * own transaction (src/lib/account-deletion.ts).
 */
export async function clearConnectionData(tx: any, connectionId: string, familyId: string) {
  await tx.calendarEventLink.deleteMany({
    where: { connection_id: connectionId, family_id: familyId },
  });
  const removed = await tx.event.deleteMany({
    where: { source_connection_id: connectionId, family_id: familyId },
  });
  return removed.count as number;
}

/**
 * Switch the synced calendar. Events imported from the previous calendar and
 * all links are removed; the next sync starts fresh on the new calendar.
 */
export async function changeCalendar(
  db: any,
  connectionId: string,
  familyId: string,
  calendar: { id: string; name: string },
): Promise<number> {
  return db.$transaction(async (tx: any) => {
    // Bump the generation first: this takes the connection row lock, so a
    // concurrent sync's guarded writes (inGeneration) wait for this
    // transaction and then abort, and anything they committed earlier is
    // removed by the cleanup below.
    await tx.calendarConnection.updateMany({
      where: { id: connectionId, family_id: familyId },
      data: {
        generation: { increment: 1 },
        calendar_id: calendar.id,
        calendar_name: calendar.name,
        sync_cursor: null,
        status: "pending",
        last_error: null,
      },
    });
    return clearConnectionData(tx, connectionId, familyId);
  });
}

/**
 * Revoke a connection's grant at the provider, best effort, with no database
 * writes. Returns true when a revoke call was made and did not throw. Used by
 * `removeConnection` (before it deletes the rows) and by account deletion
 * (after its transaction committed, so a failed deletion never leaves a
 * connection whose grant is already gone).
 */
export async function revokeProviderGrant(
  conn: { id: string; provider: string; access_token_enc: string | null; refresh_token_enc: string | null },
  familyId: string,
  deps: Pick<EngineDeps, "configFor" | "oauthFor"> = {},
): Promise<boolean> {
  if (!isProvider(conn.provider)) return false;
  const config = (deps.configFor ?? getProviderConfig)(conn.provider);
  const token =
    decryptToken(conn.refresh_token_enc, tokenAad.refresh(familyId)) ??
    decryptToken(conn.access_token_enc, tokenAad.access(familyId));
  if (!config || !token) return false;
  try {
    await (deps.oauthFor ?? ((p) => oauthFor(p)))(conn.provider).revoke(config, token);
    return true;
  } catch {
    console.warn("[calendar-sync] revoke failed", { connectionId: conn.id });
    return false;
  }
}

/**
 * Disconnect: revoke at the provider (best effort), then delete the tokens,
 * the links, the events imported from this connection, and the connection.
 * Local events that were pushed stay in the family calendar; their provider
 * copies are left in the member's calendar. Returns null when not found.
 */
export async function removeConnection(
  connectionId: string,
  familyId: string,
  deps: EngineDeps = {},
): Promise<{ removedEvents: number } | null> {
  const db = deps.db ?? prisma;
  const conn = await db.calendarConnection.findFirst({
    where: { id: connectionId, family_id: familyId },
    select: CONN_SELECT,
  });
  if (!conn) return null;

  await revokeProviderGrant(conn, familyId, deps);

  const removedEvents: number = await db.$transaction(async (tx: any) => {
    const removed = await clearConnectionData(tx, conn.id, familyId);
    await tx.calendarConnection.deleteMany({
      where: { id: conn.id, family_id: familyId },
    });
    return removed;
  });
  return { removedEvents };
}
