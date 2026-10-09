/**
 * Browser-side helpers for the review-first event import (#270): turn a
 * server suggestion into an editable draft, and a reviewed draft into an
 * event body (the `POST /api/events` field rules) for the import commit
 * route. No server-only imports: the time
 * zone maths is the same pure Intl code the ICS import uses.
 */
import { zonedWallTimeToUtc } from "@/lib/calendar-import/timezone";

/** Mirrors `EventSuggestion` in src/lib/event-import.ts (kept here so the page does not bundle the server module). */
export interface ImportSuggestion {
  title: string;
  start: string;
  end: string | null;
  allDay: boolean;
  location: string | null;
  notes: string | null;
  confidence: number;
}

export interface ImportDraft {
  key: string;
  include: boolean;
  title: string;
  /** YYYY-MM-DD */
  date: string;
  allDay: boolean;
  /** HH:MM, timed events only. */
  startTime: string;
  /** HH:MM, optional; without an end date, an end at or before the start is read as the next day. */
  endTime: string;
  /** YYYY-MM-DD, optional; the last day when the event spans several days (all day or timed). */
  endDate: string;
  location: string;
  notes: string;
  confidence: number;
  error: string | null;
}

export interface EventCreateBody {
  title: string;
  description: string | null;
  start_time: string;
  end_time?: string;
  location: string | null;
}

/** Low-confidence suggestions start unticked. */
export const IMPORT_TICK_THRESHOLD = 0.5;
/** Matches EVENT_IMPORT_UNDO_WINDOW_MS on the server. */
export const IMPORT_UNDO_WINDOW_MS = 10 * 60 * 1000;

/** What the commit route returns (201, or replayed with the same body). */
export interface ImportCommitResult {
  eventIds: string[];
  count: number;
  undoToken: string;
  undoExpiresAt: string;
}
export const IMPORT_TEXT_MAX_CHARS = 20_000;
export const IMPORT_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const IMPORT_PDF_MAX_BYTES = 10 * 1024 * 1024;

export function confidenceCategory(
  confidence: number,
): "likely" | "check" | "unsure" {
  if (confidence >= 0.8) return "likely";
  if (confidence >= IMPORT_TICK_THRESHOLD) return "check";
  return "unsure";
}
export function confidenceLabel(confidence: number): string {
  return { likely: "Likely", check: "Check this", unsure: "Unsure" }[
    confidenceCategory(confidence)
  ];
}

export function toDrafts(suggestions: ImportSuggestion[]): ImportDraft[] {
  return suggestions.map((s, i) => {
    const timed = !s.allDay && s.start.length >= 16;
    return {
      key: `s${i}`,
      include: s.confidence >= IMPORT_TICK_THRESHOLD,
      title: s.title,
      date: s.start.slice(0, 10),
      allDay: !timed,
      startTime: timed ? s.start.slice(11, 16) : "",
      endTime: timed && s.end && s.end.length >= 16 ? s.end.slice(11, 16) : "",
      // The last day: kept for multi-day all-day events and for timed events
      // that end on a later day (Fri 09:00 to Sun 17:00). Same day: blank.
      endDate:
        s.end && s.end.slice(0, 10) !== s.start.slice(0, 10)
          ? s.end.slice(0, 10)
          : "",
      location: s.location ?? "",
      notes: s.notes ?? "",
      confidence: s.confidence,
      error: null,
    };
  });
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function wall(date: string, time: string, timeZone: string): Date | null {
  const d = DATE_RE.exec(date);
  const t = TIME_RE.exec(time);
  if (!d || !t) return null;
  const [year, month, day] = [Number(d[1]), Number(d[2]), Number(d[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  )
    return null;
  return zonedWallTimeToUtc(
    { year, month, day, hour: Number(t[1]), minute: Number(t[2]), second: 0 },
    timeZone,
  );
}

/** The calendar day after `date` (YYYY-MM-DD), without touching time zones. */
export function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * The event body (the `POST /api/events` field rules, sent in a batch to the
 * import commit route) for a reviewed draft, or an error message to
 * show on the card. All-day events follow the manual form's convention
 * (00:00 on the first day to 23:59 on the last, in `timeZone`).
 */
export function draftToEventBody(
  draft: ImportDraft,
  timeZone: string,
): { ok: true; body: EventCreateBody } | { ok: false; error: string } {
  const title = draft.title.trim();
  if (!title)
    return { ok: false, error: IMPORT_VALIDATION_MESSAGES.enterTitle };
  if (title.length > 200)
    return { ok: false, error: IMPORT_VALIDATION_MESSAGES.titleLength };
  const location = draft.location.trim();
  if (location.length > 200)
    return { ok: false, error: IMPORT_VALIDATION_MESSAGES.locationLength };
  const notes = draft.notes.trim();
  if (notes.length > 1000)
    return { ok: false, error: IMPORT_VALIDATION_MESSAGES.notesLength };

  let start: Date | null;
  let end: Date | null = null;
  if (draft.allDay) {
    start = wall(draft.date, "00:00", timeZone);
    if (!start)
      return { ok: false, error: IMPORT_VALIDATION_MESSAGES.chooseDate };
    const lastDay = draft.endDate || draft.date;
    end = wall(lastDay, "23:59", timeZone);
    if (!end)
      return { ok: false, error: IMPORT_VALIDATION_MESSAGES.validEndDate };
    if (end < start)
      return { ok: false, error: IMPORT_VALIDATION_MESSAGES.endDateBefore };
  } else {
    if (!DATE_RE.test(draft.date))
      return { ok: false, error: IMPORT_VALIDATION_MESSAGES.chooseDate };
    start = wall(draft.date, draft.startTime, timeZone);
    if (!start)
      return { ok: false, error: IMPORT_VALIDATION_MESSAGES.enterStart };
    if (draft.endDate && !draft.endTime)
      return { ok: false, error: IMPORT_VALIDATION_MESSAGES.enterLastEnd };
    if (draft.endTime) {
      if (draft.endDate) {
        end = wall(draft.endDate, draft.endTime, timeZone);
        if (!end)
          return { ok: false, error: IMPORT_VALIDATION_MESSAGES.validEndDate };
        if (end <= start)
          return { ok: false, error: IMPORT_VALIDATION_MESSAGES.endBefore };
      } else {
        end = wall(draft.date, draft.endTime, timeZone);
        if (!end)
          return { ok: false, error: IMPORT_VALIDATION_MESSAGES.validEndTime };
        // An end at or before the start is the next morning (e.g. 22:00–01:00).
        // Move the local calendar day, not 24 hours, so a DST change overnight
        // still ends at the written local time.
        if (end <= start)
          end = wall(nextDay(draft.date), draft.endTime, timeZone);
      }
    }
  }

  const body: EventCreateBody = {
    title,
    description: notes || null,
    start_time: start.toISOString(),
    location: location || null,
  };
  if (end) body.end_time = end.toISOString();
  return { ok: true, body };
}

/** The device's IANA zone; the server falls back to the household default when it is missing. */
export function deviceTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/** The device's calendar day, YYYY-MM-DD. */
export function deviceToday(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Stable owned validation vocabulary; UI translates only errors from draftToEventBody, never provider text. */
export const IMPORT_VALIDATION_MESSAGES = {
  enterTitle: "Enter a title.",
  titleLength: "Keep the title under 200 characters.",
  locationLength: "Keep the location under 200 characters.",
  notesLength: "Keep the notes under 1,000 characters.",
  chooseDate: "Choose a date.",
  validEndDate: "Choose a valid end date.",
  endDateBefore: "The end date is before the start date.",
  enterStart: "Enter a start time, or tick All day.",
  enterLastEnd: "Enter an end time for the last day.",
  endBefore: "The end is before the start.",
  validEndTime: "Enter a valid end time.",
} as const;
export type ImportValidationKey = keyof typeof IMPORT_VALIDATION_MESSAGES;
export function importValidationKey(error: string): ImportValidationKey | null {
  return (
    (Object.keys(IMPORT_VALIDATION_MESSAGES) as ImportValidationKey[]).find(
      (key) => IMPORT_VALIDATION_MESSAGES[key] === error,
    ) ?? null
  );
}
