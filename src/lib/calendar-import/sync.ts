import { storageBackend } from "@/lib/storage-backend";
import { withCalendarSubscriptionAccess, lockCalendarSubscriptionInTx, type CalendarSubscriptionActor } from "@/lib/calendar-subscription-access";
import { lockHousehold } from "@/lib/household-lock";
// Sync engine for read-only ICS subscriptions (#232).
//
// fetch (guarded) -> parse + expand within a bounded window -> reconcile the
// subscription's imported Event rows by (subscription, UID, occurrence start).
// Local events (source_subscription_id = null) are never read or written here.
// See docs/architecture/CALENDAR_IMPORT.md.

import { MAX_SUBSCRIPTIONS_PER_FAMILY } from "@/lib/calendar-subscription-list";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/secret-box";
import { checkRateLimit } from "@/lib/rate-limit-db";
import {
  FeedFetchError,
  fetchFeed,
  type FetchLike,
} from "./fetch";
import { IcsParseError, parseIcsFeed, MAX_OCCURRENCES, type ImportedOccurrence } from "./parse";
import { DEFAULT_FAMILY_TIMEZONE } from "./timezone";

import { importWindow, STALE_AFTER_MS, CalendarSubscriptionSyncHeld, type SyncResult } from "./sync-values";
export { importWindow, STALE_AFTER_MS, IMPORT_WINDOW_PAST_DAYS, IMPORT_WINDOW_FUTURE_DAYS, CalendarSubscriptionSyncHeld, type SyncResult, type SubscriptionStatus } from "./sync-values";
export { MAX_SUBSCRIPTIONS_PER_FAMILY } from "@/lib/calendar-subscription-list";
export interface SyncOptions {
  db?: any;
  now?: Date;
  fetchImpl?: FetchLike;
  assertUrl?: (url: string) => Promise<void>;
  timeZone?: string;
  /** Original HTTP actor for manual refresh; never copied from a newer cookie. */
  actor?: CalendarSubscriptionActor;
}

export { toSubscriptionDto, type SubscriptionDto } from "./subscription-dto";

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
export async function reconcileOccurrencesInTx(
  tx: Prisma.TransactionClient,
  sub: { id: string; family_id: string; created_by: string },
  occurrences: ImportedOccurrence[],
  window: { start: Date; end: Date },
): Promise<{ created: number; updated: number; deleted: number }> {
  if (occurrences.length > MAX_OCCURRENCES) throw new Error("Unbounded calendar import");
  const incoming = new Map<string, ImportedOccurrence>();
  for (const occurrence of occurrences) {
    const key = keyOf(occurrence.uid, occurrence.occurrenceStart);
    if (incoming.has(key)) throw new Error("Ambiguous calendar occurrence");
    incoming.set(key, occurrence);
  }
  const fieldsOf = (occ: ImportedOccurrence) => ({
    title: occ.title, description: occ.description, location: occ.location,
    start_time: occ.start, end_time: occ.end,
  });
  const batchSize = 200;
  // Keep only the bounded incoming feed plus one existing-row batch in memory.
  // The immutable ID boundary remains valid after updates or batch deletion.
  const missing = new Map(incoming);
  let after: string | null = null;
  let updated = 0, deleted = 0, created = 0;
  for (;;) {
    const rows: ExistingRow[] = await tx.event.findMany({
      where: {
        family_id: sub.family_id, source_subscription_id: sub.id,
        ...(after === null ? {} : { id: { gt: after } }),
      },
      select: {
        id: true, source_uid: true, source_occurrence_start: true,
        title: true, description: true, location: true,
        start_time: true, end_time: true,
      },
      orderBy: { id: "asc" }, take: batchSize,
    });
    if (rows.length > batchSize || (after !== null && rows.some(row => row.id === after)))
      throw new Error("Invalid calendar import batch");
    if (!rows.length) break;
    const staleIds: string[] = [];
    for (const row of rows) {
      const key = row.source_uid && row.source_occurrence_start
        ? keyOf(row.source_uid, new Date(row.source_occurrence_start)) : null;
      const occurrence = key === null ? undefined : incoming.get(key);
      if (occurrence) {
        missing.delete(key!);
        const fields = fieldsOf(occurrence);
        if (row.title !== fields.title || (row.description ?? null) !== fields.description ||
          (row.location ?? null) !== fields.location ||
          new Date(row.start_time).getTime() !== fields.start_time.getTime() ||
          new Date(row.end_time).getTime() !== fields.end_time.getTime()) {
          await tx.event.update({
            where: { id: row.id, family_id: sub.family_id, source_subscription_id: sub.id },
            data: fields,
          });
          updated++;
        }
      } else {
        const start = new Date(row.start_time).getTime();
        // Preserve prior invalid-key cleanup and in-window deletion semantics;
        // valid older history stays unless its exact identity is updated above.
        if (key === null || (start >= window.start.getTime() && start < window.end.getTime()))
          staleIds.push(row.id);
      }
    }
    if (staleIds.length) {
      const result = await tx.event.deleteMany({ where: {
        id: { in: staleIds }, family_id: sub.family_id, source_subscription_id: sub.id,
      } });
      deleted += result.count;
    }
    after = rows[rows.length - 1].id;
    if (rows.length < batchSize) break;
  }
  const toCreate = [...missing.values()];
  for (let offset = 0; offset < toCreate.length; offset += batchSize) {
    const result = await tx.event.createMany({
      data: toCreate.slice(offset, offset + batchSize).map(occ => ({
        ...fieldsOf(occ), family_id: sub.family_id, event_type: "other",
        created_by: sub.created_by, source_subscription_id: sub.id,
        source_uid: occ.uid, source_occurrence_start: occ.occurrenceStart,
      })),
      skipDuplicates: true,
    });
    created += result.count;
  }
  return { created, updated, deleted };
}

/** Compatibility entry point; canonical batches still share one snapshot. */
export async function reconcileOccurrences(
  db: any,
  sub: { id: string; family_id: string; created_by: string },
  occurrences: ImportedOccurrence[],
  window: { start: Date; end: Date },
): Promise<{ created: number; updated: number; deleted: number }> {
  return db.$transaction((tx: Prisma.TransactionClient) => reconcileOccurrencesInTx(tx, sub, occurrences, window),
    { timeout: 30_000, isolationLevel: "RepeatableRead" });
}

type SyncSource = { id: string; family_id: string; created_by: string; url_enc: string; created_at: Date };

async function persistSubscriptionSync<T>(
  db: any, sub: SyncSource, actor: CalendarSubscriptionActor | undefined,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const apply = async (tx: Prisma.TransactionClient) => {
    if (!await lockCalendarSubscriptionInTx(tx, sub.id, sub.family_id)) throw new CalendarSubscriptionSyncHeld("source");
    const current = await tx.calendarSubscription.findFirst({
      where: { id: sub.id, family_id: sub.family_id },
      select: { url_enc: true, created_by: true, created_at: true },
    });
    if (!current || current.url_enc !== sub.url_enc || current.created_by !== sub.created_by
      || new Date(current.created_at).getTime() !== new Date(sub.created_at).getTime()) throw new CalendarSubscriptionSyncHeld("source");
    return work(tx);
  };
  if (actor) {
    if (actor.familyId !== sub.family_id) throw new CalendarSubscriptionSyncHeld("access");
    const result = await withCalendarSubscriptionAccess(db, actor, "refresh", apply);
    if (result.kind === "held") throw new CalendarSubscriptionSyncHeld("access");
    return result.value;
  }
  return db.$transaction(async (tx: Prisma.TransactionClient) => {
    await lockHousehold(tx, sub.family_id);
    return apply(tx);
  }, { timeout: 30_000, isolationLevel: "RepeatableRead" });
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
  if (storageBackend() === "d1") {
    const { syncD1CalendarSubscription } = await import("@/lib/cloudflare/calendar-sync");
    return syncD1CalendarSubscription(subscriptionId, familyId, options);
  }
  const db = options.db ?? prisma;
  const actor = options.actor ? Object.freeze({ ...options.actor }) : undefined;
  const now = options.now ?? new Date();
  const readSource = (tx: Prisma.TransactionClient) => tx.calendarSubscription.findFirst({
    where: { id: subscriptionId, family_id: familyId },
    select: {
      id: true,
      family_id: true,
      created_by: true,
      created_at: true,
      url_enc: true,
      etag: true,
      last_modified: true,
    },
  });
  if (actor && actor.familyId !== familyId) throw new CalendarSubscriptionSyncHeld("access");
  const admitted = actor
    ? await withCalendarSubscriptionAccess(db, actor, "refresh", readSource)
    : { kind: "data" as const, value: await readSource(db) };
  if (admitted.kind === "held") throw new CalendarSubscriptionSyncHeld("access");
  const sub = admitted.value;
  if (!sub) return null;

  const recordError = async (
    code: string,
    message: string,
  ): Promise<SyncResult> => {
    logFailure(sub.id, code);
    await persistSubscriptionSync(db, sub, actor, tx => tx.calendarSubscription.updateMany({
      where: { id: sub.id, family_id: familyId },
      data: { last_fetched_at: now, last_status: "error", last_error: message.slice(0, 200) },
    }));
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
    await persistSubscriptionSync(db, sub, actor, tx => tx.calendarSubscription.updateMany({
      where: { id: sub.id, family_id: familyId },
      data: { last_fetched_at: now, last_status: "ok", last_error: null },
    }));
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

  // A bounded expansion is not a complete source of truth. Never reconcile
  // its prefix: unseen existing occurrences must not become deletion candidates.
  if (parsed.truncated) {
    return recordError(
      "feed_too_large",
      "Calendar feed is too large to refresh safely. Existing events were kept.",
    );
  }

  let counts;
  try {
    counts = await persistSubscriptionSync(db, sub, actor, async tx => {
      const result = await reconcileOccurrencesInTx(tx, sub, parsed.occurrences, window);
      await tx.calendarSubscription.updateMany({
        where: { id: sub.id, family_id: familyId },
        data: { last_fetched_at: now, last_status: "ok", last_error: null,
          etag: fetched.etag, last_modified: fetched.lastModified },
      });
      return result;
    });
  } catch (cause) {
    if (cause instanceof CalendarSubscriptionSyncHeld) throw cause;
    return recordError("persist_failed", "Could not save events from this calendar");
  }

  return { status: "ok", ...counts };
}

// Coalesce only the same household and original actor context; background
// work must never lend its authority to a manual request.
const inFlight = new Map<string, Promise<SyncResult | null>>();

export function syncSubscriptionExclusive(
  subscriptionId: string,
  familyId: string,
  options: SyncOptions = {},
): Promise<SyncResult | null> {
  const key = JSON.stringify([familyId, subscriptionId, options.actor
    ? [options.actor.userId, options.actor.role, options.actor.generation] : null]);
  const existing = inFlight.get(key);
  if (existing) return existing;
  const run = syncSubscription(subscriptionId, familyId, options).finally(() => inFlight.delete(key));
  inFlight.set(key, run);
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
    const stale: Array<{ id: string }> = storageBackend() === "d1"
      ? await (await import("@/lib/cloudflare/calendar-stale")).readD1StaleCalendarSubscriptions(familyId, now, options.actor)
      : await db.calendarSubscription.findMany(
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

/** Canonical removal effects in an already-admitted transaction. */
export async function removeSubscriptionInTx(
  tx: Pick<Prisma.TransactionClient, "event" | "calendarSubscription">,
  subscriptionId: string,
  familyId: string,
): Promise<number> {
  const removed = await tx.event.deleteMany({
    where: { family_id: familyId, source_subscription_id: subscriptionId },
  });
  await tx.calendarSubscription.deleteMany({ where: { id: subscriptionId, family_id: familyId } });
  return removed.count;
}

/** Compatibility wrapper; callers with an admitted transaction reuse the same effects. */
export async function removeSubscription(
  db: any,
  subscriptionId: string,
  familyId: string,
): Promise<number> {
  return db.$transaction((tx: Prisma.TransactionClient) => removeSubscriptionInTx(tx, subscriptionId, familyId));
}
