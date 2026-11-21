/** @jest-environment jsdom */
// All-day events in the calendar views: their own strip at the top of the day,
// "All day" instead of a time, and never counted as "at the same time".
import { calendarReadOwnerHeaders } from "@/__tests__/helpers/calendar-read-owner";
import "@testing-library/jest-dom";
import * as React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "@/i18n";
import { CalendarPlanner } from "../CalendarPlanner";
jest.mock("../calendar-planner.module.css", () => ({}));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: jest.fn() }),
}));

// Local wall-clock instants, so the test holds in any runner zone.
const local = (day: string, time: string) => new Date(`${day}T${time}`).toISOString();
const events = [
  { id: "trip", title: "Field trip", start_time: local("2026-01-05", "00:00"), end_time: local("2026-01-05", "23:59"), event_type: "school", all_day: true },
  { id: "visit", title: "Grandma visits", start_time: local("2026-01-05", "00:00"), end_time: local("2026-01-07", "23:59"), event_type: "family", all_day: true },
  { id: "dentist", title: "Dentist", start_time: local("2026-01-05", "09:00"), end_time: local("2026-01-05", "10:00"), event_type: "appointment" },
];
beforeEach(() => {
  localStorage.clear();
  window.matchMedia = jest.fn().mockReturnValue({ matches: false, addEventListener: jest.fn(), removeEventListener: jest.fn() });
  global.fetch = jest.fn(async (url) => ({
    ok: true, headers: calendarReadOwnerHeaders(),
    json: async () => (String(url).includes("subscriptions") ? { subscriptions: [] } : { events, hasMore: false }),
  })) as jest.Mock;
});
const strips = () => screen.getAllByTestId("calendar-all-day");
const titles = (root: HTMLElement) => [...root.querySelectorAll("strong")].map((node) => node.textContent);

it("day view: all-day events sit in a strip above the hour grid, labelled All day", async () => {
  render(<CalendarPlanner initialDate="2026-01-05" initialView="day" canEditEvents />);
  const strip = await screen.findByTestId("calendar-all-day");
  expect(strip).toHaveAttribute("role", "group");
  expect(strip).toHaveAccessibleName("All day");
  expect(titles(strip)).toEqual(["Field trip", "Grandma visits"]);
  const trip = within(strip).getByRole("button", { name: /Field trip/ });
  expect(trip).toHaveTextContent("All day");
  expect(trip).not.toHaveTextContent(/12:00|11:59/);
  // A longer event says which days it covers.
  expect(within(strip).getByRole("button", { name: /Grandma visits/ })).toHaveTextContent("Jan 5 to Jan 7");
  // The strip comes before the timed grid, and the grid holds only the timed event.
  const grid = screen.getByLabelText("Timed calendar, all 24 hours");
  expect(strip.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(titles(grid)).toEqual(["Dentist"]);
});

it("week view: one strip per day that has all-day events, on every day they cover", async () => {
  render(<CalendarPlanner initialDate="2026-01-05" initialView="week" />);
  await screen.findAllByTestId("calendar-all-day");
  expect(strips().map(titles)).toEqual([["Field trip", "Grandma visits"], ["Grandma visits"], ["Grandma visits"]]);
  expect(screen.getByRole("heading", { level: 3, name: "Tuesday, January 6" })).toBeInTheDocument();
  expect(titles(screen.getByLabelText("Timed calendar, all 24 hours"))).toEqual(["Dentist"]);
});

it("agenda view: the strip leads the day, timed events follow", async () => {
  render(<CalendarPlanner initialDate="2026-01-05" initialView="agenda" />);
  await screen.findAllByTestId("calendar-all-day");
  const monday = screen.getByRole("heading", { level: 2, name: "Monday, January 5" }).closest("section")!;
  expect(titles(monday)).toEqual(["Field trip", "Grandma visits", "Dentist"]);
  expect(within(monday).getByTestId("calendar-all-day")).toBeInTheDocument();
  const tuesday = screen.getByRole("heading", { level: 2, name: "Tuesday, January 6" }).closest("section")!;
  expect(titles(tuesday)).toEqual(["Grandma visits"]);
  expect(within(tuesday).queryByText("No events this day")).not.toBeInTheDocument();
  const thursday = screen.getByRole("heading", { level: 2, name: "Thursday, January 8" }).closest("section")!;
  expect(within(thursday).getByText("No events this day")).toBeInTheDocument();
});

it("month view: all-day events lead the day and keep a visible All day label", async () => {
  render(<CalendarPlanner initialDate="2026-01-05" initialView="month" />);
  const cell = await screen.findByRole("region", { name: "Monday, January 5" });
  expect(titles(cell)).toEqual(["Field trip", "Grandma visits"]);
  expect(within(cell).getByRole("button", { name: /Field trip/ })).toHaveAttribute("data-all-day", "true");
  expect(within(cell).getAllByText("All day")).toHaveLength(2);
  expect(within(cell).getByRole("button", { name: /more/ })).toBeInTheDocument();
});

it("does not count all-day events as happening at the same time as anything", async () => {
  render(<CalendarPlanner initialDate="2026-01-05" initialView="day" />);
  await screen.findByTestId("calendar-all-day");
  expect(screen.queryByTestId("calendar-overlaps")).not.toBeInTheDocument();
});

it("details show the day and All day, not a midnight time, and offer no same-time review", async () => {
  render(<CalendarPlanner initialDate="2026-01-05" initialView="day" canEditEvents />);
  const strip = await screen.findByTestId("calendar-all-day");
  await userEvent.click(within(strip).getByRole("button", { name: /Grandma visits/ }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByTestId("event-detail-all-day")).toHaveTextContent("Monday, January 5, 2026 to Wednesday, January 7, 2026 · All day");
  expect(dialog).not.toHaveTextContent(/12:00|11:59/);
  expect(within(dialog).getByRole("link", { name: "Edit event" })).toHaveAttribute("href", "/dashboard/calendar/edit?id=visit");
  await userEvent.click(screen.getByRole("button", { name: "Close details" }));
  await userEvent.click(within(strip).getByRole("button", { name: /Field trip/ }));
  expect(within(screen.getByRole("dialog")).getByTestId("event-detail-all-day")).toHaveTextContent("Monday, January 5, 2026 · All day");
});

it("says it in Spanish", async () => {
  render(<I18nProvider locale="es"><CalendarPlanner initialDate="2026-01-05" initialView="day" /></I18nProvider>);
  const strip = await screen.findByTestId("calendar-all-day");
  expect(strip).toHaveAccessibleName("Todo el día");
  expect(within(strip).getByRole("button", { name: /Field trip/ })).toHaveTextContent("Todo el día");
  expect(within(strip).getByRole("button", { name: /Grandma visits/ })).toHaveTextContent(/^.*Del 5 ene al 7 ene/);
});
