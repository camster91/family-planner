/** Read canonical interval/version/freshness evidence, never provider credentials. */
import type { Prisma } from "@prisma/client";
import {
  readScheduleIntervalsInTx,
  scheduleEventToken,
  scheduleStorageAvailable,
} from "../calendar-planning/schedule-source";
import {
  readScheduleStatuses,
  scheduleStatusToken,
  assessScheduleSourceCoverage,
} from "../calendar-planning/schedule-status";
import type { FoodCalendarSnapshot, FoodPlanRequest } from "./contract";

export async function readFoodCalendar(
  tx: Prisma.TransactionClient,
  familyId: string,
  request: FoodPlanRequest,
  enabled: boolean,
  now: Date,
) {
  const windows = request.prepTiming
    ? [request.prepTiming]
    : request.slots.flatMap((slot) => (slot.timing ? [slot.timing] : []));
  if (!windows.length) return null;
  const snapshot: FoodCalendarSnapshot = {
    observedAt: now.toISOString(),
    complete: false,
    reasons: [],
    ignoredEventIds: request.ignoredCalendarEventIds,
    events: [],
    departures: [],
  };
  if (!enabled) {
    snapshot.reasons.push("calendar-disabled");
    return { snapshot, sources: null };
  }
  if (!(await scheduleStorageAvailable(tx))) {
    snapshot.reasons.push("storage-unavailable");
    return { snapshot, sources: null };
  }
  const range = {
    start: new Date(
      Math.min(...windows.map((window) => Date.parse(window.start))),
    ).toISOString(),
    end: new Date(
      Math.max(...windows.map((window) => Date.parse(window.end))),
    ).toISOString(),
  };
  const before = await readScheduleStatuses(tx, familyId);
  const rows = await readScheduleIntervalsInTx(tx, familyId, range);
  const departureIds = [
    ...new Set(
      windows.flatMap((window) =>
        window.departureEventId ? [window.departureEventId] : [],
      ),
    ),
  ].sort();
  const departures = departureIds.length
    ? await tx.event.findMany({
        where: { id: { in: departureIds }, family_id: familyId },
        select: {
          id: true,
          title: true,
          start_time: true,
          end_time: true,
          recurrence: true,
          schedule_generation: true,
          schedule_epoch: true,
          source_subscription_id: true,
          source_connection_id: true,
        },
        orderBy: { id: "asc" },
        take: 15,
      })
    : [];
  const after = await readScheduleStatuses(tx, familyId);
  const compared = new Map(rows.map((row) => [row.id, row]));
  for (const departure of departures)
    if (!compared.has(departure.id))
      compared.set(departure.id, {
        id: departure.id,
        generation: departure.schedule_generation,
        epoch: departure.schedule_epoch,
        start: departure.start_time,
        end: departure.end_time,
        recurrence: departure.recurrence,
        sourceSubscriptionId: departure.source_subscription_id,
        sourceConnectionId: departure.source_connection_id,
      });
  const intervals = [...compared.values()];
  const status = assessScheduleSourceCoverage(intervals, after, now);
  if (status.capped || rows.length > 500) snapshot.reasons.push("capped");
  if (
    status.sourcesUnavailable ||
    scheduleStatusToken(before) !== scheduleStatusToken(after)
  )
    snapshot.reasons.push("source-unavailable");
  if (intervals.some((row) => row.recurrence !== null))
    snapshot.reasons.push("recurrence-unexpanded");
  if (
    intervals.some(
      (row) =>
        !Number.isFinite(+row.start) ||
        !Number.isFinite(+row.end) ||
        +row.end <= +row.start,
    )
  )
    snapshot.reasons.push("invalid-interval");
  if (departures.length !== departureIds.length)
    snapshot.reasons.push("departure-unavailable");
  if (request.ignoredCalendarEventIds.some((id) => !compared.has(id)))
    snapshot.reasons.push("ignored-event-unavailable");
  // Source tokens validate canonical generation/epoch. Invalid identities cannot
  // be promoted to availability; interval titles are never selected by this read.
  snapshot.events = intervals
    .slice(0, 500)
    .filter((row) => +row.end > +row.start)
    .map((row) => ({
      id: row.id,
      start: row.start.toISOString(),
      end: row.end.toISOString(),
      repeating: row.recurrence !== null,
      sourceToken: scheduleEventToken(familyId, row),
    }));
  snapshot.departures = departures.map((row) => ({
    id: row.id,
    title: Array.from(row.title.normalize("NFC")).slice(0, 240).join(""),
    start: row.start_time.toISOString(),
    end: row.end_time.toISOString(),
    repeating: row.recurrence !== null,
    sourceToken: scheduleEventToken(familyId, {
      id: row.id,
      generation: row.schedule_generation,
      epoch: row.schedule_epoch,
    }),
  }));
  snapshot.complete = snapshot.reasons.length === 0;
  return { snapshot, sources: { range, rows, departures, statuses: after } };
}
