"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDisplayLocale } from "@/components/ui/use-display-locale";
import {
  addDays,
  dateAt,
  dayKey,
  matchesSource,
  planningHref,
  planningRange,
  segmentEvent,
  visibleDays,
  layoutDayEvents,
  hasClockChange,
  type PlanningView,
} from "@/lib/calendar-planning/view";
import {
  fetchPlanningRange,
  type PlanningEvent,
} from "@/lib/calendar-planning/fetch";
import styles from "./calendar-planner.module.css";
import {
  SyncNotice,
  UpdatedLine,
  useNow,
} from "@/components/fridge/sync-status";
import { useOnline } from "@/components/fridge/use-board-sync";

type Subscription = { id: string; name: string; color: string | null };
export function CalendarPlanner({
  initialDate,
  initialView,
  canEditEvents = false,
  refreshKey = 0,
  chooseLocalToday = false,
}: {
  initialDate: string;
  initialView?: PlanningView;
  canEditEvents?: boolean;
  refreshKey?: unknown;
  chooseLocalToday?: boolean;
}) {
  const router = useRouter(),
    locale = useDisplayLocale();
  const now = useNow(15000),
    online = useOnline();
  const [loadedAt, setLoadedAt] = React.useState<number | null>(null);
  const [local, setLocal] = React.useState(false),
    [date, setDate] = React.useState(initialDate),
    [view, setView] = React.useState<PlanningView>(initialView || "week");
  const [filter, setFilter] = React.useState("all"),
    [sources, setSources] = React.useState<Subscription[]>([]),
    [sourceState, setSourceState] = React.useState<
      "loading" | "ready" | "error"
    >("loading");
  const [data, setData] = React.useState<PlanningEvent[]>([]),
    [state, setState] = React.useState<"loading" | "ready" | "error">(
      "loading",
    ),
    [truncated, setTruncated] = React.useState(false),
    [retry, setRetry] = React.useState(0);
  const [selected, setSelected] = React.useState<PlanningEvent | null>(null);
  const gridViewport = React.useRef<HTMLDivElement>(null);
  const requestId = React.useRef(0),
    dialog = React.useRef<HTMLDialogElement>(null),
    trigger = React.useRef<HTMLElement | null>(null);
  React.useEffect(() => {
    setLocal(true);
    setDate(chooseLocalToday ? dayKey(new Date(), true) : initialDate);
    setView(
      initialView ||
        (window.matchMedia?.("(max-width: 639px)").matches ? "agenda" : "week"),
    );
  }, [initialDate, initialView, chooseLocalToday]);
  const days = visibleDays(date, view, local),
    range = planningRange(date, view, local),
    start = range?.start || "",
    end = range?.end || "";
  const displayState = range ? state : "unsupported";
  const previousDate = dayKey(
    addDays(dateAt(date, local), view === "day" ? -1 : -7, local),
    local,
  );
  const nextDate = dayKey(
    addDays(dateAt(date, local), view === "day" ? 1 : 7, local),
    local,
  );
  const clockChange = days.some((day) => hasClockChange(day, local));
  React.useEffect(() => {
    if (state === "ready" && gridViewport.current)
      gridViewport.current.scrollTop = 8 * 64;
  }, [state, start, view]);
  React.useEffect(() => {
    if (!local) return;
    if (!start || !end) {
      setSelected(null);
      return;
    }
    const controller = new AbortController(),
      id = ++requestId.current;
    setState("loading");
    setSelected(null);
    fetchPlanningRange(start, end, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted && id === requestId.current) {
          setData(result.events);
          setTruncated(result.truncated);
          setState("ready");
          setLoadedAt(Date.now());
        }
      })
      .catch(() => {
        if (!controller.signal.aborted && id === requestId.current)
          setState("error");
      });
    return () => controller.abort();
  }, [start, end, local, retry, refreshKey]);
  React.useEffect(() => {
    const controller = new AbortController();
    setSourceState("loading");
    fetch("/api/calendar/subscriptions", { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error();
        const body = await res.json();
        if (!Array.isArray(body.subscriptions)) throw new Error();
        if (!controller.signal.aborted) {
          setSources(
            body.subscriptions.map((s: Subscription) => ({
              id: s.id,
              name: s.name,
              color: s.color,
            })),
          );
          setSourceState("ready");
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setSourceState("error");
      });
    return () => controller.abort();
  }, [retry]);
  React.useEffect(() => {
    const refresh = () => setRetry((n) => n + 1);
    window.addEventListener("online", refresh);
    const visible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  React.useEffect(() => {
    if (selected) dialog.current?.showModal?.();
    else {
      dialog.current?.close?.();
      trigger.current?.focus();
    }
  }, [selected]);
  const options = [
    { id: "all", name: "All sources" },
    { id: "local", name: "In-app" },
    { id: "connected", name: "Connected calendar" },
    ...sources.map((s) => ({ id: `ics:${s.id}`, name: s.name })),
  ];
  const sourceName = (e: PlanningEvent) =>
    e.source?.name ||
    (e.source_subscription_id
      ? sources.find((s) => s.id === e.source_subscription_id)?.name ||
        "Subscribed calendar"
      : e.source_connection_id
        ? "Connected calendar"
        : "In-app");
  const sourceLabel = (e: PlanningEvent) =>
    `${sourceName(e)}${e.source_subscription_id || e.source ? " · ICS subscription" : ""}`;
  const label =
    options.find((s) => s.id === filter)?.name || "Selected calendar";
  const format = (d: Date, options: Intl.DateTimeFormatOptions) =>
    d.toLocaleString(locale, {
      ...options,
      ...(!local ? { timeZone: "UTC" } : {}),
    });
  const time = (d: Date) =>
    format(d, {
      hour: "numeric",
      minute: "2-digit",
      ...(clockChange ? { timeZoneName: "short" } : {}),
    });
  const move = (key: string, nextView = view) => {
    if (!planningRange(key, nextView, local)) return;
    setDate(key);
    setView(nextView);
    router.replace(planningHref(key, nextView), { scroll: false });
  };
  const filtered = data.filter((e) => matchesSource(e, filter));
  const hasVisible = days.some((day) =>
    filtered.some((e) => segmentEvent(e, day, local)),
  );
  const eventButton = (e: PlanningEvent, day: Date) => {
    const segment = segmentEvent(e, day, local)!;
    return (
      <button
        type="button"
        className={styles.event}
        onClick={(ev) => {
          trigger.current = ev.currentTarget;
          setSelected(e);
        }}
      >
        <span className={styles.eventContent}>
          <span>
            {segment.continuesBefore && segment.continuesAfter
              ? "Continuing timed event"
              : segment.continuesBefore
                ? `Until ${time(segment.end)}`
                : segment.continuesAfter
                  ? `From ${time(segment.start)} · continues`
                  : `${time(segment.start)}${+segment.start !== +segment.end ? ` – ${time(segment.end)}` : ""}`}
          </span>
          <strong>{e.title}</strong>
          <small>{sourceLabel(e)}</small>
          {segment.continuesBefore && (
            <small>
              Continues from{" "}
              {format(new Date(e.start_time), {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
                ...(clockChange ? { timeZoneName: "short" } : {}),
              })}
            </small>
          )}
          {segment.continuesAfter && (
            <small>
              Continues to{" "}
              {format(new Date(e.end_time), {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
                ...(clockChange ? { timeZoneName: "short" } : {}),
              })}
            </small>
          )}
        </span>
      </button>
    );
  };
  return (
    <div className={styles.planner}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Calendar · Private planner</p>
          <h1>
            {format(days[0], {
              weekday: view === "day" ? "long" : undefined,
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
            {days.length > 1
              ? ` – ${format(days[days.length - 1], { month: "short", day: "numeric", year: "numeric" })}`
              : ""}
          </h1>
        </div>
        <nav aria-label="Calendar view" className={styles.views}>
          {(["day", "week", "agenda"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              disabled={!planningRange(date, v, local)}
              onClick={() => move(date, v)}
            >
              {v[0].toUpperCase() + v.slice(1)}
            </button>
          ))}
        </nav>
        <Link href="/dashboard/calendar/create" className="btn-filled">
          Add event
        </Link>
      </header>
      <div className={styles.layout}>
        <aside className={styles.sources}>
          <label htmlFor="calendar-source">Calendars</label>
          <select
            id="calendar-source"
            aria-label="Calendar source"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            {options.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <div className={styles.sourceButtons}>
            {options.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={filter === s.id}
                onClick={() => setFilter(s.id)}
              >
                {s.name}
              </button>
            ))}
          </div>
          {sourceState === "loading" && <p role="status">Loading calendars…</p>}
          {sourceState === "error" && (
            <p role="alert">
              Calendar sources could not load.{" "}
              <button onClick={() => setRetry((n) => n + 1)}>
                Retry sources
              </button>
            </p>
          )}
          <p>Source filters, not people. Subscribed calendars are read-only.</p>
          <p>
            {canEditEvents
              ? "Parents may edit in-app and connected events."
              : "Create and view events. Editing is not available."}
          </p>
        </aside>
        <section className={styles.main} aria-label="Calendar range">
          {displayState === "ready" && now !== null && loadedAt !== null && (
            <div className={styles.note}>
              <UpdatedLine
                lastSyncAt={loadedAt}
                now={now}
                testId="calendar-updated"
              />
              <SyncNotice
                lastSyncAt={loadedAt}
                now={now}
                online={online}
                what="calendar"
                canGoStale={false}
                appBanner
              />
            </div>
          )}
          <div className={styles.controls}>
            <nav aria-label="Change dates">
              <button
                type="button"
                disabled={!planningRange(previousDate, view, local)}
                onClick={() => move(previousDate)}
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => move(dayKey(new Date(), local))}
              >
                Today
              </button>
              <button
                type="button"
                disabled={!planningRange(nextDate, view, local)}
                onClick={() => move(nextDate)}
              >
                Next
              </button>
            </nav>
            <p>Showing: {label}</p>
          </div>
          {clockChange && (
            <p role="status" className={styles.note}>
              Clock change in this range. Showing Agenda with time zones because
              the timed grid cannot represent skipped or repeated hours.
            </p>
          )}
          {displayState === "unsupported" && (
            <section className={styles.state} role="alert">
              <h2>Unsupported calendar date</h2>
              <p>
                This full date range falls outside the supported UTC years
                1–9999. Choose Today to return to a supported date.
              </p>
            </section>
          )}
          {displayState === "loading" && (
            <section className={styles.state} role="status">
              <h2>Loading this {view === "day" ? "day" : "week"}…</h2>
              <p>Keeping your chosen dates and calendar source.</p>
            </section>
          )}
          {displayState === "error" && (
            <section className={styles.state} role="alert">
              <h2>Calendar couldn’t load</h2>
              <p>
                We haven’t loaded this range. This is not an empty calendar.
              </p>
              <button
                className="btn-filled"
                onClick={() => setRetry((n) => n + 1)}
              >
                Try again
              </button>
            </section>
          )}
          {displayState === "ready" && truncated && (
            <section role="status" className={styles.state}>
              <h2>Only part of this range is loaded</h2>
              <p>
                Stopped after 10 pages (up to 2,000 events). Choose Day or a
                narrower date range before relying on this schedule.
              </p>
              <button onClick={() => move(date, "day")}>Show Day</button>
            </section>
          )}
          {displayState === "ready" && !hasVisible && (
            <section className={styles.state}>
              <h2>
                {filter === "all"
                  ? "No events in this range"
                  : "No events from this calendar"}
              </h2>
              <p>
                Showing: {label}
                {truncated
                  ? " · This partial result may omit matching events."
                  : ""}
              </p>
              {filter !== "all" && (
                <button onClick={() => setFilter("all")}>
                  Show all sources
                </button>
              )}
            </section>
          )}
          {displayState === "ready" &&
            hasVisible &&
            (view === "agenda" || clockChange ? (
              <div className={styles.agenda}>
                {days.map((day) => (
                  <section key={dayKey(day, local)}>
                    <h2>
                      {format(day, {
                        weekday: "long",
                        month: "long",
                        day: "numeric",
                      })}
                    </h2>
                    {filtered
                      .filter((e) => segmentEvent(e, day, local))
                      .map((e) => (
                        <React.Fragment key={e.id}>
                          {eventButton(e, day)}
                        </React.Fragment>
                      ))}
                    {!filtered.some((e) => segmentEvent(e, day, local)) && (
                      <p>No events this day</p>
                    )}
                  </section>
                ))}
              </div>
            ) : (
              <>
                <div
                  ref={gridViewport}
                  className={styles.gridScroll}
                  tabIndex={0}
                  aria-label="Timed calendar, all 24 hours"
                >
                  <div
                    className={styles.grid}
                    style={{
                      gridTemplateColumns: `3.5rem ${days.map((day) => `minmax(${Math.max(110, layoutDayEvents(filtered, day, local).lanes * 52)}px,1fr)`).join(" ")}`,
                    }}
                  >
                    <div className={styles.hours}>
                      <span>Time</span>
                      {Array.from({ length: 24 }, (_, h) => (
                        <span key={h}>
                          {new Date(Date.UTC(2026, 0, 1, h)).toLocaleTimeString(
                            locale,
                            { hour: "numeric", timeZone: "UTC" },
                          )}
                        </span>
                      ))}
                    </div>
                    {days.map((day) => {
                      const layout = layoutDayEvents(filtered, day, local);
                      return (
                        <section
                          className={styles.dayColumn}
                          key={dayKey(day, local)}
                        >
                          <h2>
                            {format(day, { weekday: "short", day: "numeric" })}
                          </h2>
                          <div
                            className={styles.dayGrid}
                            style={{
                              gridTemplateColumns: `repeat(${layout.lanes},minmax(0,1fr))`,
                            }}
                          >
                            {layout.items.map((item) => (
                              <div
                                key={item.event.id}
                                className={styles.slot}
                                style={{
                                  gridRow: `${item.startRow} / ${item.endRow}`,
                                  gridColumn: `${item.column} / span ${item.span}`,
                                }}
                              >
                                {eventButton(item.event, day)}
                              </div>
                            ))}
                          </div>
                        </section>
                      );
                    })}
                  </div>
                </div>
                {days.some(
                  (day) =>
                    layoutDayEvents(filtered, day, local).lateEvents.length > 0,
                ) && (
                  <section className={styles.agenda} aria-label="Late events">
                    <h2>Late events</h2>
                    <p>
                      These events start too close to midnight for a
                      minimum-size grid target. Their actual times are shown
                      here.
                    </p>
                    {days.map((day) => {
                      const lateEvents = layoutDayEvents(
                        filtered,
                        day,
                        local,
                      ).lateEvents;
                      return lateEvents.length > 0 ? (
                        <section key={dayKey(day, local)}>
                          <h3>
                            {format(day, {
                              weekday: "long",
                              month: "long",
                              day: "numeric",
                            })}
                          </h3>
                          {lateEvents.map((e) => (
                            <React.Fragment key={e.id}>
                              {eventButton(e, day)}
                            </React.Fragment>
                          ))}
                        </section>
                      ) : null;
                    })}
                  </section>
                )}
              </>
            ))}
          <p className={styles.note}>
            Times shown in{" "}
            {local
              ? Intl.DateTimeFormat().resolvedOptions().timeZone
              : "UTC (loading viewer time)"}
            . Continuing events keep their stored start and end. Local repeating
            rules are not expanded here; this is not a complete repeating-event
            planner.
          </p>
        </section>
      </div>
      {selected && (
        <dialog
          ref={dialog}
          open={
            typeof HTMLDialogElement === "undefined" ||
            !HTMLDialogElement.prototype.showModal
              ? true
              : undefined
          }
          className={styles.details}
          aria-labelledby="event-detail-title"
          onCancel={() => setSelected(null)}
        >
          <h2 id="event-detail-title">{selected.title}</h2>
          <p>
            <time dateTime={selected.start_time}>
              {format(new Date(selected.start_time), {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
                timeZoneName: "short",
              })}
            </time>{" "}
            –{" "}
            <time dateTime={selected.end_time}>
              {format(new Date(selected.end_time), {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
                timeZoneName: "short",
              })}
            </time>
          </p>
          <p>{sourceLabel(selected)}</p>
          {selected.location && <p>{selected.location}</p>}
          {selected.description && (
            <p className={styles.description}>{selected.description}</p>
          )}
          {(selected.source_subscription_id || selected.source) && (
            <p>
              Read-only calendar. Changes belong in the original subscription
              calendar.
            </p>
          )}
          {selected.recurrence && (
            <p>
              Repeating rule stored on this event. Only the stored occurrence is
              shown; series editing is not available.
            </p>
          )}
          <div className={styles.detailActions}>
            <button onClick={() => setSelected(null)}>Close details</button>
            {canEditEvents &&
              !selected.source_subscription_id &&
              !selected.source && (
                <Link
                  className="btn-filled"
                  href={`/dashboard/calendar/edit?id=${encodeURIComponent(selected.id)}`}
                >
                  Edit event
                </Link>
              )}
          </div>
        </dialog>
      )}
    </div>
  );
}
