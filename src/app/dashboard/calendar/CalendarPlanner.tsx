"use client";
import * as React from "react";
import Link from "next/link";
import { useTranslation } from "@/i18n";
import {
  calendarPlannerMessages,
  type CalendarPlannerMessage,
} from "@/i18n/calendar-planner";
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
import { CALENDAR_CHANGED_EVENT } from "@/lib/calendar-planning/changes";
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
  calendarSyncAvailable = false,
  refreshKey = 0,
  chooseLocalToday = false,
}: {
  initialDate: string;
  initialView?: PlanningView;
  canEditEvents?: boolean;
  calendarSyncAvailable?: boolean;
  refreshKey?: unknown;
  chooseLocalToday?: boolean;
}) {
  const { t } = useTranslation();
  const msg = (
    key: CalendarPlannerMessage,
    params?: Record<string, string | number>,
  ) => t(key, params, calendarPlannerMessages);
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
    window.addEventListener(CALENDAR_CHANGED_EVENT, refresh);
    const visible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("online", refresh);
      window.removeEventListener(CALENDAR_CHANGED_EVENT, refresh);
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
    { id: "all", name: msg("allSources") },
    { id: "local", name: msg("inApp") },
    { id: "connected", name: msg("connected") },
    ...sources.map((s) => ({ id: `ics:${s.id}`, name: s.name })),
  ];
  const sourceName = (e: PlanningEvent) =>
    e.source?.name ||
    (e.source_subscription_id
      ? sources.find((s) => s.id === e.source_subscription_id)?.name ||
        msg("subscribed")
      : e.source_connection_id
        ? msg("connected")
        : msg("inApp"));
  const sourceLabel = (e: PlanningEvent) =>
    e.source_subscription_id || e.source
      ? msg("ics", { source: sourceName(e) })
      : sourceName(e);
  const label = options.find((s) => s.id === filter)?.name || msg("selected");
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
        data-calendar-kind={e.source_subscription_id || e.source ? "subscribed" : e.source_connection_id ? "connected" : "local"}
        onClick={(ev) => {
          trigger.current = ev.currentTarget;
          setSelected(e);
        }}
      >
        <span className={styles.eventContent}>
          <span>
            {segment.continuesBefore && segment.continuesAfter
              ? msg("continuing")
              : segment.continuesBefore
                ? msg("until", { time: time(segment.end) })
                : segment.continuesAfter
                  ? msg("fromContinues", { time: time(segment.start) })
                  : `${time(segment.start)}${+segment.start !== +segment.end ? ` – ${time(segment.end)}` : ""}`}
          </span>
          <strong>{e.title}</strong>
          <small>{sourceLabel(e)}</small>
          {segment.continuesBefore && (
            <small>
              {msg("continuesFrom", {
                time: format(new Date(e.start_time), {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                  ...(clockChange ? { timeZoneName: "short" } : {}),
                }),
              })}
            </small>
          )}
          {segment.continuesAfter && (
            <small>
              {msg("continuesTo", {
                time: format(new Date(e.end_time), {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                  ...(clockChange ? { timeZoneName: "short" } : {}),
                }),
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
          <p className={styles.eyebrow}>{msg("eyebrow")}</p>
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
        <nav aria-label={msg("view")} className={styles.views}>
          {(["day", "week", "agenda"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              disabled={!planningRange(date, v, local)}
              onClick={() => move(date, v)}
            >
              {msg(v)}
            </button>
          ))}
        </nav>
        <Link href="/dashboard/calendar/create" className="btn-filled">
          {msg("add")}
        </Link>
      </header>
      <div className={styles.layout}>
        <aside className={styles.sources}>
          <label htmlFor="calendar-source">{msg("calendars")}</label>
          <select
            id="calendar-source"
            aria-label={msg("source")}
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
          {canEditEvents && (
            <details className={styles.connectionMenu}>
              <summary>{msg("addConnection")}</summary>
              <div>
                {calendarSyncAvailable && (
                  <Link href="/dashboard/settings#calendar-sync">{msg("connectProvider")}</Link>
                )}
                <Link href="/dashboard/settings#calendar-subscriptions">{msg("subscribeLink")}</Link>
              </div>
            </details>
          )}
          {sourceState === "loading" && (
            <p role="status">{msg("loadingSources")}</p>
          )}
          {sourceState === "error" && (
            <p role="alert">
              {msg("sourcesFailed")}{" "}
              <button onClick={() => setRetry((n) => n + 1)}>
                {msg("retrySources")}
              </button>
            </p>
          )}
          <p>{msg("sourceHelp")}</p>
          <p>{canEditEvents ? msg("parentHelp") : msg("memberHelp")}</p>
        </aside>
        <section className={styles.main} aria-label={msg("range")}>
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
            <nav aria-label={msg("changeDates")}>
              <button
                type="button"
                disabled={!planningRange(previousDate, view, local)}
                onClick={() => move(previousDate)}
              >
                {msg("previous")}
              </button>
              <button
                type="button"
                onClick={() => move(dayKey(new Date(), local))}
              >
                {msg("today")}
              </button>
              <button
                type="button"
                disabled={!planningRange(nextDate, view, local)}
                onClick={() => move(nextDate)}
              >
                {msg("next")}
              </button>
            </nav>
            <p>{msg("showing", { source: label })}</p>
          </div>
          {clockChange && (
            <p role="status" className={styles.note}>
              {msg("clockChange")}
            </p>
          )}
          {displayState === "unsupported" && (
            <section className={styles.state} role="alert">
              <h2>{msg("unsupported")}</h2>
              <p>{msg("unsupportedHelp")}</p>
            </section>
          )}
          {displayState === "loading" && (
            <section className={styles.state} role="status">
              <h2>{msg(view === "day" ? "loadingDay" : "loadingWeek")}</h2>
              <p>{msg("keeping")}</p>
            </section>
          )}
          {displayState === "error" && (
            <section className={styles.state} role="alert">
              <h2>{msg("loadFailed")}</h2>
              <p>{msg("notEmpty")}</p>
              <button
                className="btn-filled"
                onClick={() => setRetry((n) => n + 1)}
              >
                {msg("tryAgain")}
              </button>
            </section>
          )}
          {displayState === "ready" && truncated && (
            <section role="status" className={styles.state}>
              <h2>{msg("partial")}</h2>
              <p>{msg("partialHelp")}</p>
              <button onClick={() => move(date, "day")}>
                {msg("showDay")}
              </button>
            </section>
          )}
          {displayState === "ready" && !hasVisible && (
            <section className={view === "agenda" || clockChange ? styles.state : styles.emptyNotice}>
              <h2>{filter === "all" ? msg("empty") : msg("emptySource")}</h2>
              <p>
                {msg("showing", { source: label })}
                {truncated ? msg("partialSuffix") : ""}
              </p>
              {filter !== "all" && (
                <button onClick={() => setFilter("all")}>
                  {msg("showAll")}
                </button>
              )}
            </section>
          )}
          {displayState === "ready" &&
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
                      <p>{msg("emptyDay")}</p>
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
                  aria-label={msg("timed")}
                >
                  <div
                    className={styles.grid}
                    style={{
                      gridTemplateColumns: `3.5rem ${days.map((day) => `minmax(${Math.max(110, layoutDayEvents(filtered, day, local).lanes * 52)}px,1fr)`).join(" ")}`,
                    }}
                  >
                    <div className={styles.hours}>
                      <span>{msg("time")}</span>
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
                          <h2
                            aria-label={format(day, { weekday: "short", day: "numeric" })}
                            aria-current={local && now !== null && dayKey(day, local) === dayKey(new Date(now), true) ? "date" : undefined}
                          >
                            <span className={styles.weekday}>{format(day, { weekday: "short" })}</span>
                            <span className={styles.dayNumber}>{format(day, { day: "numeric" })}</span>
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
                  <section className={styles.agenda} aria-label={msg("late")}>
                    <h2>{msg("late")}</h2>
                    <p>{msg("lateHelp")}</p>
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
            {msg("timesHelp", {
              zone: local
                ? Intl.DateTimeFormat().resolvedOptions().timeZone
                : msg("loadingZone"),
            })}
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
            <p>{msg("readOnly")}</p>
          )}
          {selected.recurrence && <p>{msg("recurrence")}</p>}
          <div className={styles.detailActions}>
            <button onClick={() => setSelected(null)}>{msg("close")}</button>
            {canEditEvents &&
              !selected.source_subscription_id &&
              !selected.source && (
                <Link
                  className="btn-filled"
                  href={`/dashboard/calendar/edit?id=${encodeURIComponent(selected.id)}`}
                >
                  {msg("edit")}
                </Link>
              )}
          </div>
        </dialog>
      )}
    </div>
  );
}
