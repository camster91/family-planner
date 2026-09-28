// Field mapping helpers shared by the provider adapters and the sync engine (#264).

import { createHash } from "crypto";
import {
  timeZoneOffsetMs,
  zonedWallTimeToUtc,
} from "@/lib/calendar-import/timezone";

export const MAX_TITLE = 200;
export const MAX_DESCRIPTION = 5000;
export const MAX_LOCATION = 500;
export const UNTITLED = "Untitled event";

export function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

export function cleanTitle(value: unknown): string {
  return cleanText(value, MAX_TITLE) ?? UNTITLED;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "2026-09-21" -> household-local midnight of that day. */
export function localDateToInstant(date: string, timeZone: string): Date | null {
  const m = DATE_RE.exec(date);
  if (!m) return null;
  return zonedWallTimeToUtc(
    { year: +m[1], month: +m[2], day: +m[3], hour: 0, minute: 0, second: 0 },
    timeZone,
  );
}

/** Instant -> "YYYY-MM-DD" in the household zone. */
export function instantToLocalDate(instant: Date, timeZone: string): string {
  const local = new Date(
    instant.getTime() + timeZoneOffsetMs(instant.getTime(), timeZone),
  );
  return local.toISOString().slice(0, 10);
}

/** True when both bounds sit on household-local midnights (an all-day span). */
export function isLocalMidnightSpan(
  start: Date,
  end: Date,
  timeZone: string,
): boolean {
  const at = (d: Date) => localDateToInstant(instantToLocalDate(d, timeZone), timeZone);
  return (
    end.getTime() > start.getTime() &&
    at(start)?.getTime() === start.getTime() &&
    at(end)?.getTime() === end.getTime()
  );
}

export interface SyncedFields {
  title: string;
  description: string | null;
  location: string | null;
  start_time: Date;
  end_time: Date;
}

/** Hash of the fields sync compares; a local edit changes it. */
export function fieldsHash(e: SyncedFields): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        e.title,
        e.description ?? null,
        e.location ?? null,
        new Date(e.start_time).getTime(),
        new Date(e.end_time).getTime(),
      ]),
    )
    .digest("hex");
}

/** Stable per (connection, local event) value for provider-side idempotent creates. */
export function createKey(connectionId: string, eventId: string): string {
  return createHash("sha256")
    .update(`family-planner:calendar-push:${connectionId}:${eventId}`)
    .digest("hex");
}
