export type PlanningView = "day" | "week" | "agenda";
/** A fixed 24-hour axis cannot truthfully represent skipped or repeated hours. */
export function hasClockChange(day: Date, local: boolean): boolean {
  return local && +addDays(day, 1, local) - +day !== 24 * 60 * 60 * 1000;
}
export function dayKey(date: Date, local: boolean): string {
  const y = local ? date.getFullYear() : date.getUTCFullYear();
  const m = (local ? date.getMonth() : date.getUTCMonth()) + 1;
  const d = local ? date.getDate() : date.getUTCDate();
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
export function dateAt(key: string, local: boolean): Date {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(0);
  if (local) {
    date.setFullYear(y, m - 1, d);
    date.setHours(0, 0, 0, 0);
  } else {
    date.setUTCFullYear(y, m - 1, d);
    date.setUTCHours(0, 0, 0, 0);
  }
  return date;
}
export function addDays(date: Date, count: number, local: boolean): Date {
  const next = new Date(date);
  if (local) next.setDate(next.getDate() + count);
  else next.setUTCDate(next.getUTCDate() + count);
  return next;
}
export interface EventOrigin {
  source_subscription_id?: string | null;
  source_connection_id?: string | null;
  source?: {
    subscription_id: string;
    name: string;
    color: string | null;
  } | null;
}
export function matchesSource(event: EventOrigin, filter: string): boolean {
  const subscription =
    event.source_subscription_id || event.source?.subscription_id;
  if (filter === "all") return true;
  if (filter === "local") return !subscription && !event.source_connection_id;
  if (filter === "connected")
    return !subscription && !!event.source_connection_id;
  return filter === `ics:${subscription}`;
}
export function parsePlanningDate(key?: string): string | null {
  if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(key) || key.startsWith("0000"))
    return null;
  return dayKey(dateAt(key, false), false) === key ? key : null;
}
export function planningHref(key: string, view: PlanningView): string {
  const [year, month] = key.split("-").map(Number);
  return `/dashboard/calendar?year=${year}&month=${month}&date=${key}&view=${view}`;
}
export function segmentEvent(
  event: { start_time: string; end_time: string },
  day: Date,
  local: boolean,
) {
  const start = new Date(event.start_time),
    end = new Date(event.end_time),
    next = addDays(day, 1, local);
  if (
    start >= next ||
    (start.getTime() === end.getTime() ? start < day : end <= day)
  )
    return null;
  return {
    start: new Date(Math.max(+start, +day)),
    end: new Date(Math.min(+end, +next)),
    continuesBefore: start < day,
    continuesAfter: end > next,
  };
}
export function layoutDayEvents<
  T extends { id: string; start_time: string; end_time: string },
>(events: T[], day: Date, local: boolean) {
  const minutes = (d: Date) =>
    local
      ? d.getHours() * 60 + d.getMinutes()
      : d.getUTCHours() * 60 + d.getUTCMinutes();
  const lateEvents: T[] = [];
  const items = events
    .flatMap((event) => {
      const segment = segmentEvent(event, day, local);
      if (!segment) return [];
      const startRow = Math.floor(minutes(segment.start) / 30) + 1;
      // Two 32px tracks keep a 44px target. Never grow an implicit 49th track
      // or move the start earlier: late starts belong in the labelled list.
      if (startRow + 2 > 49) {
        lateEvents.push(event);
        return [];
      }
      const clockEnd =
        +segment.end === +addDays(day, 1, local)
          ? 49
          : Math.ceil(minutes(segment.end) / 30) + 1;
      return [
        {
          event,
          startRow,
          endRow: Math.max(startRow + 2, clockEnd),
          column: 1,
          span: 1,
        },
      ];
    })
    .sort(
      (a, b) => a.startRow - b.startRow || a.event.id.localeCompare(b.event.id),
    );
  const groups: (typeof items)[] = [];
  let group: typeof items = [];
  let until = 0;
  for (const item of items) {
    if (item.startRow >= until && group.length) {
      groups.push(group);
      group = [];
    }
    group.push(item);
    until = Math.max(group.length === 1 ? 0 : until, item.endRow);
  }
  if (group.length) groups.push(group);
  let lanes = 1;
  for (const cluster of groups) {
    const ends: number[] = [];
    for (const item of cluster) {
      let lane = ends.findIndex((end) => end <= item.startRow);
      if (lane === -1) lane = ends.length;
      ends[lane] = item.endRow;
      item.column = lane + 1;
    }
    lanes = Math.max(lanes, ends.length);
  }
  for (const cluster of groups) {
    if (cluster.length === 1) cluster[0].span = lanes;
  }
  return { items, lanes, lateEvents };
}
export function visibleDays(
  key: string,
  view: PlanningView,
  local: boolean,
): Date[] {
  let start = dateAt(key, local);
  if (view === "week")
    start = addDays(
      start,
      -(((local ? start.getDay() : start.getUTCDay()) + 6) % 7),
      local,
    );
  return Array.from({ length: view === "day" ? 1 : 7 }, (_, i) =>
    addDays(start, i, local),
  );
}

/** Match the API's converted UTC year and positive <=45-day read bounds. */
export function planningRange(
  key: string,
  view: PlanningView,
  local: boolean,
): { start: string; end: string } | null {
  if (!parsePlanningDate(key)) return null;
  const days = visibleDays(key, view, local);
  const start = days[0];
  const end = addDays(days[days.length - 1], 1, local);
  const span = +end - +start;
  if (
    ![start, end].every(
      (instant) =>
        Number.isFinite(+instant) &&
        instant.getUTCFullYear() >= 1 &&
        instant.getUTCFullYear() <= 9999,
    ) ||
    span <= 0 ||
    span > 45 * 24 * 60 * 60 * 1000
  )
    return null;
  return { start: start.toISOString(), end: end.toISOString() };
}
