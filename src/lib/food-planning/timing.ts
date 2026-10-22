/** Continuous recorded-calendar fit for an explicit window. Not personal availability. */
import type {
  FoodTimingRequest,
  FoodTimingResult,
  FoodCalendarSnapshot,
} from "./contract";
export function planFoodTiming(
  request: FoodTimingRequest | undefined,
  minutes: number | null,
  calendar?: FoodCalendarSnapshot,
): FoodTimingResult {
  const result: FoodTimingResult = {
    state: "not-requested",
    start: null,
    finish: null,
    readyBy: null,
    occupiedMinutes: null,
    blockingEventIds: [],
    reasons: [],
    departure: null,
  };
  if (!request) return result;
  result.state = "unknown";
  const departure = request.departureEventId
    ? calendar?.departures.find(
        (event) => event.id === request.departureEventId,
      )
    : undefined;
  result.departure = departure ?? null;
  if (request.departureEventId && !departure)
    result.reasons.push("departure-unavailable");
  if (!calendar?.complete) result.reasons.push("calendar-incomplete");
  if (minutes === null || !Number.isFinite(minutes) || minutes < 0)
    result.reasons.push("duration-unknown");
  if (result.reasons.length) return result;
  const occupied =
    minutes! +
    request.beforeCookingMinutes +
    request.eatingMinutes +
    request.cleanupMinutes;
  result.occupiedMinutes = occupied;
  const deadline = Math.min(
    Date.parse(request.end),
    departure
      ? Date.parse(departure.start) -
          (request.travelMinutes + request.departurePreparationMinutes) * 60000
      : Infinity,
  );
  const from = Math.max(
    Date.parse(request.start),
    Date.parse(calendar!.observedAt),
  );
  result.readyBy = new Date(deadline).toISOString();
  if (
    !Number.isFinite(from) ||
    !Number.isFinite(deadline) ||
    deadline <= from
  ) {
    result.state = "conflict";
    result.reasons.push("window-passed");
    return result;
  }
  const duration = occupied * 60000;
  const ignored = new Set(calendar!.ignoredEventIds);
  const events = calendar!.events
    .filter(
      (event) =>
        !ignored.has(event.id) &&
        Date.parse(event.start) < deadline &&
        Date.parse(event.end) > from,
    )
    .map((event) => ({
      id: event.id,
      start: Date.parse(event.start),
      end: Date.parse(event.end),
    }))
    .sort(
      (a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id),
    );
  let cursor = from;
  for (const event of events) {
    if (event.end <= cursor) continue;
    // Half-open boundaries: finishing as an event starts is allowed. Require
    // even a zero-minute authored dish to start in free time, never in an event.
    if (
      event.start > cursor &&
      cursor + duration <= Math.min(event.start, deadline)
    ) {
      result.state = "fits";
      result.start = new Date(cursor).toISOString();
      result.finish = new Date(cursor + duration).toISOString();
      result.blockingEventIds = [...new Set(result.blockingEventIds)].slice(
        0,
        20,
      );
      return result;
    }
    result.blockingEventIds.push(event.id);
    cursor = Math.max(cursor, event.end);
    if (cursor >= deadline) break;
  }
  if (cursor < deadline && cursor + duration <= deadline) {
    result.state = "fits";
    result.start = new Date(cursor).toISOString();
    result.finish = new Date(cursor + duration).toISOString();
  } else {
    result.state = "conflict";
    result.reasons.push("no-contiguous-window");
  }
  result.blockingEventIds = [...new Set(result.blockingEventIds)].slice(0, 20);
  return result;
}
