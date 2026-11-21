/** @jest-environment jsdom */
// All-day events on the Today board: listed first with "All day" in the time
// column, and shown without a time in Coming up. Instants are local wall-clock
// so the expectations hold in any runner zone.
import "@testing-library/jest-dom";
import * as React from "react";
import { render, screen, within } from "@testing-library/react";
import { I18nProvider } from "@/i18n";
import { comingUp, eventsLeftToday, eventsStartingOn, nextEvent } from "../board-model";
import { ComingUpRegion, ScheduleRegion, eventTimeLabel } from "../regions";
import type { BoardEvent } from "@/app/dashboard/today/today-board-data";

const local = (day: number, hour: number, minute = 0) => new Date(2026, 0, day, hour, minute).toISOString();
// Monday 2026-01-05, 10:00 local.
const NOW = new Date(2026, 0, 5, 10, 0);
const ev = (id: string, start: string, end: string, extra: Partial<BoardEvent> = {}): BoardEvent =>
  ({ id, title: id, start, end, isTask: false, source: null, ...extra });
const allDay = (id: string, firstDay: number, lastDay = firstDay) => ev(id, local(firstDay, 0), local(lastDay, 23, 59), { allDay: true });

const events = [
  ev("Dentist", local(5, 9), local(5, 11)),
  ev("Swim", local(5, 16), local(5, 17)),
  allDay("Field trip", 5),
  allDay("Grandma visits", 4, 6),
  // Imported feeds use midnight to the next midnight.
  ev("PD day", local(6, 0), local(7, 0), { allDay: true }),
  allDay("Yesterday only", 4),
  ev("Library", local(6, 15), local(6, 16)),
];

describe("board model", () => {
  it("lists today's all-day events first, then timed events by start", () => {
    const today = eventsLeftToday(events, NOW);
    expect(today.map((e) => e.id)).toEqual(["Grandma visits", "Field trip", "Dentist", "Swim"]);
    // An all-day event is never "Now": it has no start time to be past.
    expect(today.filter((e) => e.allDay).every((e) => e.happeningNow === false)).toBe(true);
    expect(today.find((e) => e.id === "Dentist")).toMatchObject({ happeningNow: true });
    expect(today.find((e) => e.id === "Grandma visits")).toMatchObject({ startedEarlier: true });
    expect(today.find((e) => e.id === "Field trip")).toMatchObject({ startedEarlier: false });
  });

  it("keeps an all-day event on the board until its day is over, and never the day after", () => {
    const lateEvening = new Date(2026, 0, 5, 23, 59, 30);
    expect(eventsLeftToday(events, lateEvening).map((e) => e.id)).toEqual(["Grandma visits", "Field trip"]);
    // The day after an imported midnight-to-midnight event, it is gone.
    const afterPdDay = new Date(2026, 0, 7, 0, 0, 30);
    expect(eventsLeftToday(events, afterPdDay).map((e) => e.id)).not.toContain("PD day");
  });

  it("puts all-day events first on a coming day, including one that continues into it", () => {
    expect(eventsStartingOn(events, "2026-01-06").map((e) => e.id)).toEqual(["Grandma visits", "PD day", "Library"]);
    expect(eventsStartingOn(events, "2026-01-07").map((e) => e.id)).toEqual([]);
    expect(comingUp(events, null, NOW, 1)[0].events.map((e) => e.id)).toEqual(["Grandma visits", "PD day", "Library"]);
  });

  it("names the next all-day event by its day, never by a midnight time", () => {
    expect(nextEvent([allDay("Field trip", 6)], NOW)).toEqual({ title: "Field trip", when: "Tomorrow" });
    expect(nextEvent([allDay("Recital", 7)], NOW)).toEqual({ title: "Recital", when: "Wed" });
    expect(nextEvent([ev("Library", local(6, 9), local(6, 10))], NOW)).toEqual({ title: "Library", when: "Tomorrow 9:00 AM" });
  });
});

describe("board regions", () => {
  it('shows "All day" in the time column and no "Now" tag', () => {
    render(<I18nProvider locale="en"><ScheduleRegion events={eventsLeftToday(events, NOW)} calendarHref="/dashboard/calendar" /></I18nProvider>);
    const rows = screen.getAllByTestId("today-event");
    expect(rows.map((row) => row.querySelector("p")!.textContent)).toEqual(["All day", "All day", "9:00 AM", "4:00 PM"]);
    expect(within(rows[0]).getByText("Grandma visits")).toBeInTheDocument();
    expect(within(rows[0]).queryByText("Now")).not.toBeInTheDocument();
    expect(within(rows[2]).getByText("Now")).toBeInTheDocument();
  });

  it("says it in Spanish", () => {
    render(<I18nProvider locale="es"><ScheduleRegion events={eventsLeftToday([allDay("Excursión", 5)], NOW)} calendarHref={null} /></I18nProvider>);
    expect(screen.getByTestId("today-event").querySelector("p")!.textContent).toBe("Todo el día");
  });

  it("keeps the older label rules for timed events", () => {
    const [timed] = eventsLeftToday([ev("Swim", local(5, 16), local(5, 17))], NOW);
    expect(eventTimeLabel(timed, "en-US")).toBe("4:00 PM");
    expect(eventTimeLabel({ ...timed, allDay: true }, "en-US")).toBe("All day");
  });

  it("shows an all-day event in Coming up with its title and no time", () => {
    render(<I18nProvider locale="en"><ComingUpRegion days={comingUp(events, null, NOW, 1)} mealsEnabled={false} /></I18nProvider>);
    const day = screen.getByTestId("coming-up-day");
    const lines = [...day.querySelectorAll("li > p")].map((p) => p.textContent);
    expect(lines).toEqual(["Grandma visits", "PD day", "3:00 PM Library"]);
    expect(day.textContent).not.toMatch(/12:00 AM/);
  });
});
