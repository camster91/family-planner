// ICS parsing + bounded recurrence expansion for read-only subscriptions (#232).
//
// Library: ical.js (Mozilla, MPL-2.0, zero runtime dependencies, pure JS). It
// is the parser Thunderbird uses and supports RRULE/RDATE/EXDATE and
// RECURRENCE-ID overrides. We deliberately do NOT register feed VTIMEZONEs in
// ical.js's process-global TimezoneService (one feed must never affect how
// another is read); instead every wall-clock time is converted to an instant
// here, preferring the runtime's IANA database (see ./timezone.ts).
//
// Output is a flat list of occurrences keyed by (UID, original occurrence
// start) — the idempotency key persisted on Event.

import ICAL from "ical.js";
import {
  DEFAULT_FAMILY_TIMEZONE,
  isValidTimeZone,
  zonedWallTimeToUtc,
} from "./timezone";

type IcalComponent = InstanceType<typeof ICAL.Component>;
type IcalTime = InstanceType<typeof ICAL.Time>;
type IcalEvent = InstanceType<typeof ICAL.Event>;
type IcalTimezone = InstanceType<typeof ICAL.Timezone>;

export interface ImportedOccurrence {
  uid: string;
  /** Identity of the occurrence: RECURRENCE-ID instant, or DTSTART when not recurring. */
  occurrenceStart: Date;
  start: Date;
  end: Date;
  allDay: boolean;
  title: string;
  description: string | null;
  location: string | null;
}

export interface ExpandOptions {
  windowStart: Date;
  windowEnd: Date;
  /** Zone for floating times and all-day dates. */
  defaultTimeZone?: string;
  /** Hard cap on returned occurrences for one feed. */
  maxOccurrences?: number;
}

export interface ParsedFeed {
  occurrences: ImportedOccurrence[];
  /** True when caps were hit and some occurrences were dropped. */
  truncated: boolean;
}

/** Raised for input that is not a usable iCalendar document. Carries no feed content. */
export class IcsParseError extends Error {
  constructor() {
    super("Feed is not a valid calendar");
    this.name = "IcsParseError";
  }
}

export const MAX_OCCURRENCES = 3000;
// Iteration guard per series: a daily rule starting decades ago still reaches
// the window (~20k days), but FREQ=SECONDLY-style abuse cannot spin forever.
const MAX_ITERATIONS_PER_SERIES = 25000;
// An override may move an instance earlier than its RECURRENCE-ID; keep
// iterating a little past the window so such moves are still seen.
const LOOKAHEAD_MS = 31 * 24 * 60 * 60 * 1000;

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 1000;
const LOCATION_MAX = 200;
const UID_MAX = 500;

// Common Windows zone names seen in Outlook/Exchange feeds without a usable VTIMEZONE.
const WINDOWS_ZONES: Record<string, string> = {
  "Eastern Standard Time": "America/Toronto",
  "Central Standard Time": "America/Chicago",
  "Mountain Standard Time": "America/Edmonton",
  "Pacific Standard Time": "America/Vancouver",
  "Atlantic Standard Time": "America/Halifax",
  "Newfoundland Standard Time": "America/St_Johns",
  "GMT Standard Time": "Europe/London",
  "W. Europe Standard Time": "Europe/Berlin",
  "Romance Standard Time": "Europe/Paris",
  UTC: "UTC",
};

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  // Drop control characters other than newline/tab.
  const cleaned = value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
  if (!cleaned) return null;
  return cleaned.length > max ? cleaned.slice(0, max) : cleaned;
}

/** Map a TZID parameter to an IANA zone name when possible. */
export function normalizeTzid(tzid: string): string | null {
  const trimmed = tzid.trim().replace(/^"|"$/g, "");
  if (isValidTimeZone(trimmed)) return trimmed;
  if (WINDOWS_ZONES[trimmed]) return WINDOWS_ZONES[trimmed];
  // Prefixed forms like "/mozilla.org/20050126_1/America/Toronto" or
  // "/softwarestudio.org/Olson_20011030_5/America/Toronto".
  const segments = trimmed.split("/").filter(Boolean);
  for (let i = 0; i < segments.length - 1; i++) {
    const candidate = segments.slice(i).join("/");
    if (isValidTimeZone(candidate)) return candidate;
  }
  return null;
}

class TimeResolver {
  constructor(
    private readonly vtimezones: Map<string, IcalTimezone>,
    private readonly defaultTimeZone: string,
  ) {}

  /** Instant for an ical.js time whose DTSTART-style property carried `tzid`. */
  toInstant(time: IcalTime, tzid: string | null): Date {
    const wall = {
      year: time.year,
      month: time.month,
      day: time.day,
      hour: time.isDate ? 0 : time.hour,
      minute: time.isDate ? 0 : time.minute,
      second: time.isDate ? 0 : time.second,
    };
    // All-day dates are calendar days in the household's zone.
    if (time.isDate) return zonedWallTimeToUtc(wall, this.defaultTimeZone);

    const zone = time.zone as { tzid?: string } | undefined;
    if (zone && zone.tzid === "UTC") {
      return new Date(
        Date.UTC(
          wall.year,
          wall.month - 1,
          wall.day,
          wall.hour,
          wall.minute,
          wall.second,
        ),
      );
    }

    if (tzid) {
      const iana = normalizeTzid(tzid);
      if (iana) return zonedWallTimeToUtc(wall, iana);
      const vtz = this.vtimezones.get(tzid);
      if (vtz) {
        try {
          const offsetSeconds = vtz.utcOffset(time);
          return new Date(
            Date.UTC(
              wall.year,
              wall.month - 1,
              wall.day,
              wall.hour,
              wall.minute,
              wall.second,
            ) -
              offsetSeconds * 1000,
          );
        } catch {
          // Fall through to the household zone.
        }
      }
    }
    // Floating time (or an unresolvable zone): household local time.
    return zonedWallTimeToUtc(wall, this.defaultTimeZone);
  }
}

function tzidOf(component: IcalComponent, propName: string): string | null {
  const prop = component.getFirstProperty(propName);
  if (!prop) return null;
  const tzid = prop.getParameter("tzid");
  return typeof tzid === "string"
    ? tzid
    : Array.isArray(tzid)
      ? String(tzid[0])
      : null;
}

function isCancelled(component: IcalComponent): boolean {
  const status = component.getFirstPropertyValue("status");
  return typeof status === "string" && status.toUpperCase() === "CANCELLED";
}

function parseRoot(text: string): IcalComponent {
  if (typeof text !== "string" || !/BEGIN:VCALENDAR/i.test(text))
    throw new IcsParseError();
  let jcal: unknown;
  try {
    jcal = ICAL.parse(text);
  } catch {
    throw new IcsParseError();
  }
  // Several concatenated VCALENDARs parse to an array of components; use the first.
  const first = Array.isArray(jcal) && Array.isArray(jcal[0]) ? jcal[0] : jcal;
  let root: IcalComponent;
  try {
    root = new ICAL.Component(first as any);
  } catch {
    throw new IcsParseError();
  }
  if (root.name !== "vcalendar") throw new IcsParseError();
  return root;
}

/**
 * Parse an ICS document and expand it to concrete occurrences overlapping
 * [windowStart, windowEnd). Throws IcsParseError for malformed input.
 */
export function parseIcsFeed(text: string, options: ExpandOptions): ParsedFeed {
  const root = parseRoot(text);
  const windowStart = options.windowStart.getTime();
  const windowEnd = options.windowEnd.getTime();
  const maxOccurrences = options.maxOccurrences ?? MAX_OCCURRENCES;
  const defaultTimeZone =
    options.defaultTimeZone && isValidTimeZone(options.defaultTimeZone)
      ? options.defaultTimeZone
      : DEFAULT_FAMILY_TIMEZONE;

  const vtimezones = new Map<string, IcalTimezone>();
  for (const vtz of root.getAllSubcomponents("vtimezone")) {
    const tzid = vtz.getFirstPropertyValue("tzid");
    if (typeof tzid !== "string") continue;
    try {
      vtimezones.set(tzid, new ICAL.Timezone(vtz));
    } catch {
      // Ignore unusable VTIMEZONE blocks.
    }
  }
  const resolver = new TimeResolver(vtimezones, defaultTimeZone);

  // Group by UID: one master (no RECURRENCE-ID) plus its overrides.
  const masters = new Map<string, IcalComponent>();
  const overrides = new Map<string, IcalComponent[]>();
  for (const vevent of root.getAllSubcomponents("vevent")) {
    const rawUid = vevent.getFirstPropertyValue("uid");
    const uid = cleanText(typeof rawUid === "string" ? rawUid : null, UID_MAX);
    if (!uid) continue; // no stable identity -> cannot be imported idempotently
    if (vevent.hasProperty("recurrence-id")) {
      overrides.set(uid, [...(overrides.get(uid) ?? []), vevent]);
    } else if (!masters.has(uid)) {
      masters.set(uid, vevent);
    }
  }

  const out = new Map<string, ImportedOccurrence>();
  let truncated = false;

  const emit = (
    uid: string,
    identity: Date,
    item: IcalEvent,
    startTime: IcalTime,
    endTime: IcalTime,
  ) => {
    const component = item.component;
    if (isCancelled(component)) return;
    const start = resolver.toInstant(startTime, tzidOf(component, "dtstart"));
    let end = resolver.toInstant(
      endTime,
      tzidOf(component, "dtend") ?? tzidOf(component, "dtstart"),
    );
    if (isNaN(start.getTime())) return;
    if (isNaN(end.getTime()) || end < start) end = start;
    // Overlap test; zero-length events count when their start is in the window.
    const overlaps =
      end.getTime() === start.getTime()
        ? start.getTime() >= windowStart && start.getTime() < windowEnd
        : start.getTime() < windowEnd && end.getTime() > windowStart;
    if (!overlaps) return;
    const key = `${uid}\u0000${identity.getTime()}`;
    if (out.has(key)) return;
    if (out.size >= maxOccurrences) {
      truncated = true;
      return;
    }
    out.set(key, {
      uid,
      occurrenceStart: identity,
      start,
      end,
      allDay: startTime.isDate,
      title: cleanText(item.summary, TITLE_MAX) ?? "Untitled event",
      description: cleanText(item.description, DESCRIPTION_MAX),
      location: cleanText(item.location, LOCATION_MAX),
    });
  };

  for (const [uid, master] of masters) {
    if (isCancelled(master)) continue;
    let event: IcalEvent;
    try {
      event = new ICAL.Event(master);
      for (const override of overrides.get(uid) ?? [])
        event.relateException(override);
    } catch {
      continue;
    }
    const masterTzid = tzidOf(master, "dtstart");

    if (!event.isRecurring()) {
      if (!event.startDate) continue;
      const identity = resolver.toInstant(event.startDate, masterTzid);
      emit(uid, identity, event, event.startDate, event.endDate);
      continue;
    }

    try {
      const iterator = event.iterator();
      let iterations = 0;
      let next: IcalTime | null;
      while ((next = iterator.next())) {
        if (++iterations > MAX_ITERATIONS_PER_SERIES) {
          truncated = true;
          break;
        }
        const identity = resolver.toInstant(next, masterTzid);
        if (identity.getTime() > windowEnd + LOOKAHEAD_MS) break;
        const details = event.getOccurrenceDetails(next);
        emit(uid, identity, details.item, details.startDate, details.endDate);
        if (truncated) break;
      }
    } catch {
      // A broken rule skips just this series.
      continue;
    }
  }

  // Overrides whose master is missing from the feed: import as single events.
  for (const [uid, list] of overrides) {
    if (masters.has(uid)) continue;
    for (const component of list) {
      try {
        const event = new ICAL.Event(component);
        const recurrenceId = component.getFirstPropertyValue(
          "recurrence-id",
        ) as IcalTime | null;
        if (!recurrenceId || !event.startDate) continue;
        const identity = resolver.toInstant(
          recurrenceId,
          tzidOf(component, "recurrence-id"),
        );
        emit(uid, identity, event, event.startDate, event.endDate);
      } catch {
        continue;
      }
    }
  }

  const occurrences = [...out.values()].sort(
    (a, b) =>
      a.start.getTime() - b.start.getTime() || a.uid.localeCompare(b.uid),
  );
  return { occurrences, truncated };
}
