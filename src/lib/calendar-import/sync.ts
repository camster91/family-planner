// Sync engine for read-only ICS subscriptions (#232).
//
// fetch (guarded) -> parse + expand within a bounded window -> reconcile the
// subscription's imported Event rows by (subscription, UID, occurrence start).
// Local events (source_subscription_id = null) are never read or written here.
// See docs/architecture/CALENDAR_IMPORT.md.

import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/secret-box";
import { checkRateLimit } from "@/lib/rate-limit-db";
import {
  FeedFetchError,
  fetchFeed,
  feedUrlHint,
  type FetchLike,
} from "./fetch";
import { IcsParseError, parseIcsFeed, type ImportedOccurrence } from "./parse";
import { DEFAULT_FAMILY_TIMEZONE } from "./timezone";

const DAY_MS = 24 * 60 * 60 * 1000;
export const IMPORT_WINDOW_PAST_DAYS = 30;
export const IMPORT_WINDOW_FUTURE_DAYS = 180;
export const STALE_AFTER_MS = 15 * 60 * 1000;
export const MAX_SUBSCRIPTIONS_PER_FAMILY = 10;

export type SubscriptionStatus = "pending" | "ok" | "error";

export interface SyncResult {
  status: "ok" | "not_modified" | "error";
  created: number;
  updated: number;
  deleted: number;
  error?: string;
}

export interface SyncOptions {
  db?: any;
  now?: Date;
  fetchImpl?: FetchLike;
  assertUrl?: (url: string) => Promise<void>;
  timeZone?: string;
}

export function importWindow(now: Date): { start: Date; end: Date } {
  return {
    start: new Date(now.getTime() - IMPORT_WINDOW_PAST_DAYS * DAY_MS),
    end: new Date(now.getTime() + IMPORT_WINDOW_FUTURE_DAYS * DAY_MS),
  };
}

/** Client-facing shape. The URL itself is never included; parents get a host-only hint. */
export interface SubscriptionDto {
  id: string;
  name: string;
  color: string | null;
  url_hint?: string;
  last_fetched_at: string | null;
  last_status: string;
  last_error: string | null;
  created_at: string;
}

export function toSubscriptionDto(
  sub: {
    id: string;
    name: string;
    color?: string | null;
    url_enc?: string | null;
    last_fetched_at?: Date | null;
    last_status?: string | null;
    last_error?: string | null;
    created_at?: Date | null;
  },
  opts: { includeUrlHint?: boolean } = {},
): SubscriptionDto {
  const dto: SubscriptionDto = {
    id: sub.id,
    name: sub.name,
    color: sub.color ?? null,
    last_fetched_at: sub.last_fetched_at
      ? new Date(sub.last_fetched_at).toISOString()
      : null,
    last_status: sub.last_status ?? "pending",
    last_error: sub.last_error ?? null,
    created_at: sub.created_at
      ? new Date(sub.created_at).toISOString()
      : new Date(0).toISOString(),
  };
  if (opts.includeUrlHint)
    dto.url_hint = feedUrlHint(decryptSecret(sub.url_enc));
  return dto;
}

// Content-minimal logging: subscription id and a fixed error code only.
function logFailure(subscriptionId: string, code: string) {
  console.warn("[calendar-import] refresh failed", { subscriptionId, code });
}

type ExistingRow = {
  id: string;
  source_uid: string | null;
  source_occurrence_start: Date | null;
  title: string;
  description: string | null;
  location: string | null;
  start_time: Date;
  end_time: Date;
};

const keyOf = (uid: string, occurrence: Date) =>
  `${uid}\u0000${occurrence.getTime()}`;

/**
 * Reconcile imported events for one subscription with the parsed feed.
 * Creates new occurrences, updates changed ones, and deletes rows inside the
 * window whose (UID, occurrence) no longer appears. Scoped to the
 * subscription AND its family on every statement.
 */
export async function reconcileOccurrences(
  db: any,
  sub: { id: string; family_id: string; created_by: string },
  occurrences: ImportedOccurrence[],
  window: { start: Date; end: Date },
): Promise<{ created: number; updated: number; deleted: number }> {
  return db.$transaction(
    async (tx: any) => {
      const existing: ExistingRow[] = await tx.event.findMany({
        where: { family_id: sub.family_id, source_subscription_id: sub.id },
        select: {
          id: true,
          source_uid: true,
          source_occurrence_start: true,
          title: true,
          description: true,
          location: true,
          start_time: true,
          end_time: true,
        },
      });
      const byKey = new Map<string, ExistingRow>();
      for (const row of existing) {
        if (row.source_uid && row.source_occurrence_start) {
          byKey.set(
            keyOf(row.source_uid, new Date(row.source_occurrence_start)),
            row,
          );
        }
      }

      const seen = new Set<string>();
      const toCreate: Record<string, unknown>[] = [];
      let updated = 0;
      for (const occ of occurrences) {
        const key = keyOf(occ.uid, occ.occurrenceStart);
        seen.add(key);
        const fields = {
          title: occ.title,
          description: occ.description,
          location: occ.location,
          start_time: occ.start,
          end_time: occ.end,
        };
        const row = byKey.get(key);
        if (!row) {
          toCreate.push({
            ...fields,
            family_id: sub.family_id,
            event_type: "other",
            created_by: sub.created_by,
            source_subscription_id: sub.id,
            source_uid: occ.uid,
            source_occurrence_start: occ.occurrenceStart,
          });
          continue;
        }
        const changed =
          row.title !== fields.title ||
          (row.description ?? null) !== fields.description ||
          (row.location ?? null) !== fields.location ||
          new Date(row.start_time).getTime() !== fields.start_time.getTime() ||
          new Date(row.end_time).getTime() !== fields.end_time.getTime();
        if (changed) {
          await tx.event.update({
            where: { id: row.id, source_subscription_id: sub.id },
            data: fields,
          });
          updated++;
        }
      }

      let created = 0;
      if (toCreate.length > 0) {
        // skipDuplicates: a concurrent refresh that won the race is harmless.
        const result = await tx.event.createMany({
          data: toCreate,
          skipDuplicates: true,
        });
        created = result.count;
      }

      const staleIds = existing
        .filter((row) => {
          if (!row.source_uid || !row.source_occurrence_start) return true;
          if (
            seen.has(
              keyOf(row.source_uid, new Date(row.source_occurrence_start)),
            )
          )
            return false;
          const start = new Date(row.start_time).getTime();
          // Only prune inside the sync window; older imported rows stay as history.
          return (
            start >= window.start.getTime() && start < window.end.getTime()
          );
        })
        .map((row) => row.id);
      let deleted = 0;
      if (staleIds.length > 0) {
        const result = await tx.event.deleteMany({
          where: {
            id: { in: staleIds },
            family_id: sub.family_id,
            source_subscription_id: sub.id,
          },
        });
        deleted = result.count;
      }
      return { created, updated, deleted };
    },
    { timeout: 30_000 },
  );
}

/**
 * Fetch, parse and reconcile one subscription. Returns null when the
 * subscription does not exist in `familyId` (callers answer 404).
 */
export async function syncSubscription(
  subscriptionId: string,
  familyId: string,
  options: SyncOptions = {},
): Promise<SyncResult | null> {
  const db = options.db ?? prisma;
  const now = options.now ?? new Date();
  const sub = await db.calendarSubscription.findFirst({
    where: { id: subscriptionId, family_id: familyId },
    select: {
      id: true,
      family_id: true,
      created_by: true,
      url_enc: true,
      etag: true,
      last_modified: true,
    },
  });
  if (!sub) return null;

  const recordError = async (
    code: string,
    message: string,
  ): Promise<SyncResult> => {
    logFailure(sub.id, code);
    await db.calendarSubscription.updateMany({
      where: { id: sub.id, family_id: familyId },
      data: {
        last_fetched_at: now,
        last_status: "error",
        last_error: message.slice(0, 200),
      },
    });
    return {
      status: "error",
      created: 0,
      updated: 0,
      deleted: 0,
      error: message,
    };
  };

  const url = decryptSecret(sub.url_enc);
  if (!url)
    return recordError(
      "url_unreadable",
      "Saved calendar link could not be read. Remove and add it again.",
    );

  let fetched;
  try {
    fetched = await fetchFeed(url, {
      etag: sub.etag,
      lastModified: sub.last_modified,
      fetchImpl: options.fetchImpl,
      assertUrl: options.assertUrl,
    });
  } catch (err) {
    if (err instanceof FeedFetchError)
      return recordError(err.code, err.message);
    return recordError("unknown", "Could not refresh this calendar");
  }

  if (fetched.notModified) {
    await db.calendarSubscription.updateMany({
      where: { id: sub.id, family_id: familyId },
      data: { last_fetched_at: now, last_status: "ok", last_error: null },
    });
    return { status: "not_modified", created: 0, updated: 0, deleted: 0 };
  }

  const window = importWindow(now);
  let parsed;
  try {
    parsed = parseIcsFeed(fetched.body, {
      windowStart: window.start,
      windowEnd: window.end,
      defaultTimeZone: options.timeZone ?? DEFAULT_FAMILY_TIMEZONE,
    });
  } catch (err) {
    if (err instanceof IcsParseError)
      return recordError("invalid_ics", err.message);
    return recordError("parse_failed", "Feed is not a valid calendar");
  }

  let counts;
  try {
    counts = await reconcileOccurrences(db, sub, parsed.occurrences, window);
  } catch {
    return recordError(
      "persist_failed",
      "Could not save events from this calendar",
    );
  }

  await db.calendarSubscription.updateMany({
    where: { id: sub.id, family_id: familyId },
    data: {
      last_fetched_at: now,
      last_status: "ok",
      last_error: parsed.truncated
        ? "Some events were skipped because the feed is very large"
        : null,
      etag: fetched.etag,
      last_modified: fetched.lastModified,
    },
  });
  return { status: "ok", ...counts };
}

// One refresh per subscription per process at a time; concurrent callers share it.
const inFlight = new Map<string, Promise<SyncResult | null>>();

export function syncSubscriptionExclusive(
  subscriptionId: string,
  familyId: string,
  options: SyncOptions = {},
): Promise<SyncResult | null> {
  const existing = inFlight.get(subscriptionId);
  if (existing) return existing;
  const run = syncSubscription(subscriptionId, familyId, options).finally(() =>
    inFlight.delete(subscriptionId),
  );
  inFlight.set(subscriptionId, run);
  return run;
}

/**
 * Refresh this family's subscriptions not fetched in the last 15 minutes.
 * Called fire-and-forget after the dashboard renders (no scheduler, per
 * AGENTS.md). A DB-backed rate-limit window per subscription acts as a lease
 * so many open dashboards/replicas do not stampede the provider.
 */
export async function refreshStaleSubscriptions(
  familyId: string,
  options: SyncOptions = {},
): Promise<number> {
  const db = options.db ?? prisma;
  const now = options.now ?? new Date();
  let refreshed = 0;
  try {
    const stale: Array<{ id: string }> = await db.calendarSubscription.findMany(
      {
        where: {
          family_id: familyId,
          OR: [
            { last_fetched_at: null },
            {
              last_fetched_at: { lt: new Date(now.getTime() - STALE_AFTER_MS) },
            },
          ],
        },
        select: { id: true },
        orderBy: { last_fetched_at: "asc" },
        take: MAX_SUBSCRIPTIONS_PER_FAMILY,
      },
    );
    for (const { id } of stale) {
      const lease = await checkRateLimit(
        `calsub-auto:${id}`,
        1,
        STALE_AFTER_MS,
      );
      if (!lease.allowed) continue;
      await syncSubscriptionExclusive(id, familyId, options);
      refreshed++;
    }
  } catch {
    console.warn("[calendar-import] background refresh failed", { familyId });
  }
  return refreshed;
}

/** Remove a subscription and only the events it imported. */
export async function removeSubscription(
  db: any,
  subscriptionId: string,
  familyId: string,
): Promise<number> {
  return db.$transaction(async (tx: any) => {
    const removed = await tx.event.deleteMany({
      where: { family_id: familyId, source_subscription_id: subscriptionId },
    });
    await tx.calendarSubscription.deleteMany({
      where: { id: subscriptionId, family_id: familyId },
    });
    return removed.count as number;
  });
}
