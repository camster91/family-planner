/** @jest-environment jsdom */
import { calendarReadOwnerHeaders } from "@/__tests__/helpers/calendar-read-owner";
import * as React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
jest.mock("../calendar-planner.module.css", () => ({}));
import { CalendarPlanner } from "../CalendarPlanner";
import { personFilterStorageKey } from "@/lib/person-filter-preference";
jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: jest.fn(), refresh: jest.fn() }),
}));

const mia = { kind: "account" as const, id: "u1", name: "Mia Fixture-A", color: "green" };
const casey = { kind: "profile" as const, id: "m1", name: "Casey Fixture-A", color: "sky" };
const people = [
  { key: "account:u1", name: mia.name, color: mia.color },
  { key: "profile:m1", name: casey.name, color: casey.color },
];
const base = { event_type: "other", source: null };
const events = [
  { ...base, id: "a", title: "Swim", start_time: "2026-01-05T09:00:00Z", end_time: "2026-01-05T10:00:00Z", participants: [mia] },
  { ...base, id: "b", title: "Dentist", start_time: "2026-01-05T11:00:00Z", end_time: "2026-01-05T12:00:00Z", participants: [casey] },
  { ...base, id: "c", title: "Family dinner", start_time: "2026-01-05T17:00:00Z", end_time: "2026-01-05T18:00:00Z" },
];

beforeEach(() => {
  window.localStorage.clear();
  window.matchMedia = jest.fn().mockReturnValue({
    matches: true,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  });
  global.fetch = jest.fn(async (url) => ({
    ok: true,
    headers: calendarReadOwnerHeaders(),
    json: async () =>
      String(url).includes("subscriptions")
        ? { subscriptions: [] }
        : { events, hasMore: false, nextCursor: null },
  })) as jest.Mock;
});

it("shows who each event is for as first-name chips", async () => {
  render(<CalendarPlanner initialDate="2026-01-05" initialView="agenda" people={people} />);
  const swim = await screen.findByRole("button", { name: /Swim/ });
  expect(within(swim).getByTestId("person-chip").querySelector("[data-person-name]")?.textContent).toBe("Mia");
  expect(swim.textContent).not.toContain("Fixture-A");
  const dinner = screen.getByRole("button", { name: /Family dinner/ });
  expect(within(dinner).queryByTestId("person-chip")).toBeNull();
});

it("filters to one person's events, remembers the choice, and offers a way back", async () => {
  const first = render(<CalendarPlanner initialDate="2026-01-05" initialView="agenda" people={people} />);
  await screen.findByRole("button", { name: /Swim/ });
  const group = screen.getByRole("group", { name: "Show events for" });
  expect(within(group).getByRole("button", { name: "Everyone" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(within(group).getByRole("button", { name: /Casey/ }));
  expect(screen.queryByRole("button", { name: /Swim/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /Family dinner/ })).toBeNull();
  expect(screen.getByRole("button", { name: /Dentist/ })).toBeTruthy();
  expect(window.localStorage.getItem(personFilterStorageKey("calendar"))).toBe("profile:m1");
  first.unmount();

  // The same device comes back to Casey's events.
  global.fetch = jest.fn(async (url) => ({
    ok: true,
    headers: calendarReadOwnerHeaders(),
    json: async () =>
      String(url).includes("subscriptions")
        ? { subscriptions: [] }
        : { events: [events[0]], hasMore: false, nextCursor: null },
  })) as jest.Mock;
  render(<CalendarPlanner initialDate="2026-01-05" initialView="agenda" people={people} />);
  expect(await screen.findByRole("heading", { name: "No events for Casey in this range" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Show everyone" }));
  expect(await screen.findByRole("button", { name: /Swim/ })).toBeTruthy();
  expect(window.localStorage.getItem(personFilterStorageKey("calendar"))).toBeNull();
});

it("shows no person filter when people on events is off", async () => {
  render(<CalendarPlanner initialDate="2026-01-05" initialView="agenda" />);
  await screen.findByRole("button", { name: /Swim/ });
  expect(screen.queryByTestId("person-filter")).toBeNull();
});
