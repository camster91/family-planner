/** @jest-environment jsdom */
import * as React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
jest.mock("../calendar-planner.module.css", () => ({}));
import { CalendarPlanner } from "../CalendarPlanner";
jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: jest.fn(), refresh: jest.fn() }),
}));
const event = {
  id: "e",
  title: "Workshop",
  start_time: "2026-01-05T09:00:00Z",
  end_time: "2026-01-05T11:00:00Z",
  event_type: "other",
  source_connection_id: "private-provider",
  source: null,
};
beforeEach(() => {
  window.matchMedia = jest.fn().mockReturnValue({
    matches: true,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  });
  global.fetch = jest.fn(async (url) => ({
    ok: true,
    json: async () =>
      String(url).includes("subscriptions")
        ? {
            subscriptions: [{ id: "empty", name: "Empty school", color: null }],
          }
        : { events: [event], hasMore: false, nextCursor: null },
  })) as jest.Mock;
});
it("shows overflow late-day targets in an explicitly labelled list, not shifted clock rows", async () => {
  const day = new Date(2026, 0, 5, 23, 30);
  const end = new Date(2026, 0, 5, 23, 45);
  global.fetch = jest.fn(async (url) => ({
    ok: true,
    json: async () =>
      String(url).includes("subscriptions")
        ? { subscriptions: [] }
        : {
            events: [
              {
                ...event,
                title: "Late appointment",
                start_time: day.toISOString(),
                end_time: end.toISOString(),
              },
            ],
            hasMore: false,
            nextCursor: null,
          },
  })) as jest.Mock;
  render(<CalendarPlanner initialDate="2026-01-05" initialView="day" />);
  const card = await screen.findByRole("button", { name: /Late appointment/ });
  expect(screen.getByRole("heading", { name: "Late events" })).toBeTruthy();
  expect(screen.getByText(/too close to midnight.*minimum/i)).toBeTruthy();
  expect(
    screen.getByLabelText("Timed calendar, all 24 hours").contains(card),
  ).toBe(false);
  expect(card.textContent).toMatch(/11:30.*11:45/);
  fireEvent.click(card);
  expect(
    screen
      .getByRole("dialog")
      .querySelector(`time[datetime="${day.toISOString()}"]`),
  ).not.toBeNull();
});
it("allocates enough clock-column width for four overlapping 44px targets", async () => {
  global.fetch = jest.fn(async (url) => ({
    ok: true,
    json: async () =>
      String(url).includes("subscriptions")
        ? { subscriptions: [] }
        : {
            events: Array.from({ length: 4 }, (_, i) => ({
              ...event,
              id: String(i),
              title: `Overlap ${i}`,
            })),
            hasMore: false,
            nextCursor: null,
          },
  })) as jest.Mock;
  render(<CalendarPlanner initialDate="2026-01-05" initialView="day" />);
  await screen.findByRole("button", { name: /Overlap 0/ });
  const grid = screen.getByLabelText("Timed calendar, all 24 hours")
    .firstElementChild as HTMLElement;
  expect(grid.style.gridTemplateColumns).toContain("minmax(208px,1fr)");
});
it("labels a full continuing timed segment without inventing all-day or midnight duration", async () => {
  global.fetch = jest.fn(async (url) => ({
    ok: true,
    json: async () =>
      String(url).includes("subscriptions")
        ? { subscriptions: [] }
        : {
            events: [
              {
                ...event,
                start_time: "2026-01-04T10:00:00Z",
                end_time: "2026-01-08T10:00:00Z",
              },
            ],
            hasMore: false,
            nextCursor: null,
          },
  })) as jest.Mock;
  render(<CalendarPlanner initialDate="2026-01-05" initialView="day" />);
  await screen.findByRole("button", { name: /Workshop/ });
  expect(screen.getByText("Continuing timed event")).toBeTruthy();
  expect(screen.queryByText(/all.day/i)).toBeNull();
});
it("loads a bounded week, discovers empty sources and opens teen details without edit", async () => {
  render(
    <CalendarPlanner
      initialDate="2026-01-05"
      initialView="week"
      canEditEvents={false}
    />,
  );
  await screen.findByRole("button", { name: /Workshop/ });
  expect(
    (global.fetch as jest.Mock).mock.calls.some(
      ([u]) => String(u).includes("start=") && String(u).includes("end="),
    ),
  ).toBe(true);
  expect(screen.getByLabelText("Timed calendar, all 24 hours").scrollTop).toBe(
    512,
  );
  expect(screen.getByTestId("calendar-updated")).toBeTruthy();
  expect(screen.getByRole("option", { name: "Empty school" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Workshop/ }));
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(
    screen
      .getByRole("dialog")
      .querySelector(`time[datetime="${event.start_time}"]`),
  ).not.toBeNull();
  expect(
    screen
      .getByRole("dialog")
      .querySelector(`time[datetime="${event.end_time}"]`),
  ).not.toBeNull();
  expect(screen.queryByRole("link", { name: "Edit event" })).toBeNull();
  expect(screen.getAllByText("Connected calendar").length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: "Close details" }));
  fireEvent.change(screen.getByLabelText("Calendar source"), {
    target: { value: "ics:empty" },
  });
  expect(screen.getByText("No events from this calendar")).toBeTruthy();
});
it('keeps the week grid available when there are no events', async () => {
  global.fetch = jest.fn(async (url) => ({ ok: true, json: async () => String(url).includes('subscriptions') ? { subscriptions: [] } : { events: [], hasMore: false, nextCursor: null } })) as jest.Mock;
  render(<CalendarPlanner initialDate="2026-01-05" initialView="week" />);
  await screen.findByText('No events in this range');
  expect(screen.getByLabelText('Timed calendar, all 24 hours')).toBeTruthy();
  expect(screen.getByRole('heading', { name: /Mon/ }).textContent).toContain('5');
});
