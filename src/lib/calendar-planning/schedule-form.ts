/** Explicit wall-time choices for the personal review form. Unlike ICS import,
 * nonexistent times are refused and repeated times require an offset choice. */
import { isValidTimeZone } from "@/lib/calendar-import/timezone";
import { parseCalendarInstant, CALENDAR_RANGE_MAX_MS } from "./instant";
import {
  scheduleBuffers,
  scheduleReviewScope,
  type ScheduleBuffers,
  type ScheduleReviewScope,
  type ScheduleReviewSnapshot,
  type ScheduleReviewQuery,
} from "./conflict-review";
export type BufferDraft = {
  preparation: string;
  travelBefore: string;
  travelAfter: string;
};
export const EMPTY_BUFFER_DRAFT: Readonly<BufferDraft> = Object.freeze({
  preparation: "0",
  travelBefore: "0",
  travelAfter: "0",
});
export type WindowDraft = {
  start: string;
  end: string;
  startChoice: string | null;
  endChoice: string | null;
};
export type OtherBufferDraft = { sourceToken: string; buffers: BufferDraft };
export class ScheduleDraftError extends Error {}
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(zone: string) {
  let value = formatters.get(zone);
  if (!value) {
    value = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(zone, value);
  }
  return value;
}
function parts(instant: number, zone: string) {
  const values = formatter(zone).formatToParts(new Date(instant));
  const get = (key: string) =>
    values.find((value) => value.type === key)?.value ?? "";
  return `${get("year").padStart(4, "0")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;
}
export function scheduleWall(instant: string, zone: string) {
  return parts(+parseCalendarInstant(instant), zone);
}
export function scheduleWallChoices(value: string, zone: string): string[] {
  if (
    !isValidTimeZone(zone) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)
  )
    return [];
  const wall = value.length === 16 ? `${value}:00` : value;
  let guess: number;
  try {
    guess = +parseCalendarInstant(`${wall}Z`);
  } catch {
    return [];
  }
  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 6) {
    const sample = guess + hours * 3600000;
    try {
      offsets.add(+parseCalendarInstant(`${parts(sample, zone)}Z`) - sample);
    } catch {
      /* Boundary-era formatting has no valid choice. */
    }
  }
  return [
    ...new Set(
      [...offsets]
        .map((offset) => guess - offset)
        .filter((candidate) => parts(candidate, zone) === wall)
        .map((candidate) => new Date(candidate).toISOString()),
    ),
  ].sort();
}
export function resolveScheduleWall(
  value: string,
  selected: string | null,
  zone: string,
) {
  const choices = scheduleWallChoices(value, zone);
  if (choices.length === 1) return choices[0];
  if (selected && choices.includes(selected)) return selected;
  throw new ScheduleDraftError("Choose an actual, unambiguous time");
}
export function windowDraft(scope: ScheduleReviewScope): WindowDraft {
  return {
    start: scheduleWall(scope.range.start, scope.timeZone),
    end: scheduleWall(scope.range.end, scope.timeZone),
    startChoice: new Date(scope.range.start).toISOString(),
    endChoice: new Date(scope.range.end).toISOString(),
  };
}
export function parseBufferDraft(draft: BufferDraft): ScheduleBuffers {
  if (Object.values(draft).some((value) => !/^\d{1,3}$/.test(value)))
    throw new ScheduleDraftError("Enter whole minutes");
  const result = scheduleBuffers.safeParse({
    preparation: Number(draft.preparation),
    travelBefore: Number(draft.travelBefore),
    travelAfter: Number(draft.travelAfter),
  });
  if (!result.success) throw new ScheduleDraftError("Use 0–240 minutes");
  return result.data;
}
export function resolveScheduleDraft(
  snapshot: ScheduleReviewSnapshot,
  targetId: string,
  buffers: BufferDraft,
  windows: WindowDraft[],
  others: Record<string, OtherBufferDraft>,
) {
  const target = snapshot.events.find((event) => event.id === targetId);
  if (!target) throw new ScheduleDraftError("Reload the event");
  const parsedBuffers = parseBufferDraft(buffers);
  if (
    windows.length < 1 ||
    windows.length > 16 ||
    Object.keys(others).length > 100
  )
    throw new ScheduleDraftError("Too many comparison inputs");
  const instants = windows.map((window) => {
    const start = resolveScheduleWall(
        window.start,
        window.startChoice,
        snapshot.timeZone,
      ),
      end = resolveScheduleWall(
        window.end,
        window.endChoice,
        snapshot.timeZone,
      );
    if (Date.parse(end) <= Date.parse(start))
      throw new ScheduleDraftError("End must follow start");
    return { start, end };
  });
  const start = Math.min(
      ...instants.map((window) => Date.parse(window.start)),
      Date.parse(target.start) -
        (parsedBuffers.preparation + parsedBuffers.travelBefore) * 60000,
    ),
    end = Math.max(
      ...instants.map((window) => Date.parse(window.end)),
      Date.parse(target.end) + parsedBuffers.travelAfter * 60000,
    );
  if (end - start > CALENDAR_RANGE_MAX_MS)
    throw new ScheduleDraftError(
      "Comparison including the original event must fit within 45 days",
    );
  const scope = scheduleReviewScope.parse({
    targetId,
    range: {
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
    },
    timeZone: snapshot.timeZone,
  });
  const otherBuffers = Object.entries(others).map(([id, value]) => {
    const current = snapshot.events.find((event) => event.id === id);
    if (
      !current ||
      id === targetId ||
      current.sourceToken !== value.sourceToken
    )
      throw new ScheduleDraftError("Review changed comparison buffers");
    return {
      id,
      sourceToken: value.sourceToken,
      buffers: parseBufferDraft(value.buffers),
    };
  });
  return { scope, buffers: parsedBuffers, windows: instants, otherBuffers };
}
export function queryForSchedule(
  snapshot: ScheduleReviewSnapshot,
  targetId: string,
  draft: ReturnType<typeof resolveScheduleDraft>,
  gridMinutes: ScheduleReviewQuery["gridMinutes"],
): ScheduleReviewQuery {
  const target = snapshot.events.find((event) => event.id === targetId);
  if (!target) throw new ScheduleDraftError("Reload the event");
  // Re-resolve existing override versions against this fresh projection.
  for (const row of draft.otherBuffers)
    if (
      snapshot.events.find((event) => event.id === row.id)?.sourceToken !==
      row.sourceToken
    )
      throw new ScheduleDraftError("Review changed comparison buffers");
  return {
    protocol: snapshot.protocol,
    owner: snapshot.owner,
    snapshotToken: snapshot.snapshotToken,
    target: { id: target.id, sourceToken: target.sourceToken },
    range: snapshot.range,
    timeZone: snapshot.timeZone,
    buffers: draft.buffers,
    windows: draft.windows,
    otherBuffers: draft.otherBuffers,
    gridMinutes,
  };
}

const displayFormatters = new Map<string, Intl.DateTimeFormat>();
/** Preserve exact seconds/milliseconds when present; ordinary minute-aligned
 * family events stay compact. Unsupported format options fall back to exact
 * explicitly labelled UTC, never to a guessed wall time. */
export function formatScheduleInstant(
  value: string,
  locale: string,
  zone: string,
) {
  const instant = parseCalendarInstant(value),
    precision = instant.getUTCMilliseconds()
      ? 3
      : instant.getUTCSeconds()
        ? 1
        : 0,
    key = JSON.stringify([locale, zone, precision]);
  try {
    let display = displayFormatters.get(key);
    if (!display) {
      display = new Intl.DateTimeFormat(locale, {
        timeZone: zone,
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "shortOffset",
        ...(precision ? { second: "2-digit" as const } : {}),
        ...(precision === 3 ? { fractionalSecondDigits: 3 as const } : {}),
      });
      displayFormatters.set(key, display);
    }
    return display.format(instant);
  } catch {
    return `${instant.toISOString()} (UTC)`;
  }
}
