/** @jest-environment jsdom */
import * as React from "react";
import { runInThisContext } from "node:vm";
// Jest's process.env is sandboxed; set the real Node timezone and restore it.
const runtimeProcess = runInThisContext("process") as NodeJS.Process;
const originalTZ =
  runtimeProcess.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
beforeAll(() => {
  runtimeProcess.env.TZ = "America/New_York";
});
afterAll(() => {
  runtimeProcess.env.TZ = originalTZ;
});
import { render, screen } from "@testing-library/react";
import { CalendarPlanner } from "../CalendarPlanner";
import { addDays, dateAt } from "@/lib/calendar-planning/view";
jest.mock("../calendar-planner.module.css", () => ({}));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: jest.fn() }),
}));

beforeEach(() => {
  // Guard that the real local clock uses New York, not the host default.
  expect(new Date("2026-11-01T05:30:00Z").getTimezoneOffset()).toBe(240);
  expect(new Date("2026-11-01T06:15:00Z").getTimezoneOffset()).toBe(300);
  global.fetch = jest.fn(async (url) => ({
    ok: true,
    json: async () =>
      String(url).includes("subscriptions")
        ? { subscriptions: [] }
        : {
            events: [
              {
                id: "fold",
                title: "Fold appointment",
                event_type: "other",
                start_time: "2026-11-01T05:30:00Z",
                end_time: "2026-11-01T06:15:00Z",
              },
            ],
            hasMore: false,
            nextCursor: null,
          },
  })) as jest.Mock;
});
it.each(["day", "week"] as const)(
  "uses explicit Agenda fallback for a clock-change %s range",
  async (view) => {
    render(<CalendarPlanner initialDate="2026-11-01" initialView={view} />);
    const card = await screen.findByRole("button", {
      name: /Fold appointment/,
    });
    expect(screen.getByText(/Clock change.*Agenda/i)).toBeTruthy();
    expect(screen.queryByLabelText("Timed calendar, all 24 hours")).toBeNull();
    expect(card.textContent).toMatch(/1:30.*EDT.*1:15.*EST/);
    const request = (global.fetch as jest.Mock).mock.calls.find(([url]) =>
      String(url).includes("start="),
    );
    const query = new URL(String(request![0]), "http://localhost").searchParams;
    const first =
      view === "day" ? dateAt("2026-11-01", true) : dateAt("2026-10-26", true);
    expect(query.get("start")).toBe(first.toISOString());
    expect(query.get("end")).toBe(
      addDays(first, view === "day" ? 1 : 7, true).toISOString(),
    );
  },
);
it("shows zones on continuation timestamps in the clock-change fallback", async () => {
  global.fetch = jest.fn(async (url) => ({
    ok: true,
    json: async () =>
      String(url).includes("subscriptions")
        ? { subscriptions: [] }
        : {
            events: [
              {
                id: "continuing",
                title: "Continuing fold appointment",
                event_type: "other",
                start_time: "2026-10-31T05:30:00Z",
                end_time: "2026-11-03T06:15:00Z",
              },
            ],
            hasMore: false,
            nextCursor: null,
          },
  })) as jest.Mock;
  render(<CalendarPlanner initialDate="2026-11-01" initialView="day" />);
  const card = await screen.findByRole("button", {
    name: /Continuing fold appointment/,
  });
  expect(card.textContent).toMatch(/Continues from.*EDT/);
  expect(card.textContent).toMatch(/Continues to.*EST/);
});
it("also uses Agenda on a spring-forward day with skipped clock times", async () => {
  render(<CalendarPlanner initialDate="2026-03-08" initialView="day" />);
  expect(await screen.findByText(/Clock change.*Agenda/i)).toBeTruthy();
  expect(screen.queryByLabelText("Timed calendar, all 24 hours")).toBeNull();
});
