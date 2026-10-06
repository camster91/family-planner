/** @jest-environment jsdom */
import * as React from "react";
import { runInThisContext } from "node:vm";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CalendarPlanner } from "../CalendarPlanner";
jest.mock("../calendar-planner.module.css", () => ({}));
const replace = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
const runtimeProcess = runInThisContext("process") as NodeJS.Process;
const originalTZ =
  runtimeProcess.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
afterEach(() => {
  runtimeProcess.env.TZ = originalTZ;
});
beforeEach(() => {
  replace.mockClear();
  global.fetch = jest.fn(async (url) => ({
    ok: true,
    json: async () =>
      String(url).includes("subscriptions")
        ? { subscriptions: [] }
        : { events: [], hasMore: false, nextCursor: null },
  })) as jest.Mock;
});
const eventRequests = () =>
  (global.fetch as jest.Mock).mock.calls.filter(([url]) =>
    String(url).includes("start="),
  );
it.each([
  ["UTC", "9999-12-31", "day"],
  ["UTC", "9999-12-30", "week"],
  ["UTC", "9999-12-25", "agenda"],
  ["Etc/GMT-14", "0001-01-01", "day"],
  ["Etc/GMT+12", "9999-12-31", "day"],
] as const)(
  "rejects the complete UTC-converted %s %s %s range and recovers with Today",
  async (zone, date, view) => {
    runtimeProcess.env.TZ = zone;
    render(<CalendarPlanner initialDate={date} initialView={view} />);
    expect(
      await screen.findByRole("heading", { name: "Unsupported calendar date" }),
    ).toBeTruthy();
    expect(eventRequests()).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.queryByText("No events in this range")).toBeNull();
    expect(
      (
        screen.getByRole("button", {
          name: date.startsWith("0001") ? "Previous" : "Next",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    await screen.findByText("No events in this range");
    expect(eventRequests()).toHaveLength(1);
    expect(
      screen.queryByRole("heading", { name: "Unsupported calendar date" }),
    ).toBeNull();
  },
);
it.each([
  ["UTC", "0001-01-01", "Previous"],
  ["UTC", "9999-12-30", "Next"],
  ["Etc/GMT-14", "0001-01-02", "Previous"],
  ["Etc/GMT-14", "9999-12-31", "Next"],
  ["Etc/GMT+12", "0001-01-01", "Previous"],
  ["Etc/GMT+12", "9999-12-30", "Next"],
] as const)(
  "disables unsupported %s %s %s navigation from a valid local day",
  async (zone, date, direction) => {
    runtimeProcess.env.TZ = zone;
    render(<CalendarPlanner initialDate={date} initialView="day" />);
    await screen.findByText("No events in this range");
    expect(eventRequests()).toHaveLength(1);
    const query = new URL(String(eventRequests()[0][0]), "http://localhost")
      .searchParams;
    const start = new Date(query.get("start")!);
    const end = new Date(query.get("end")!);
    expect(start.getUTCFullYear()).toBeGreaterThanOrEqual(1);
    expect(end.getUTCFullYear()).toBeLessThanOrEqual(9999);
    expect(+end - +start).toBeGreaterThan(0);
    expect(+end - +start).toBeLessThanOrEqual(45 * 86400000);
    const button = screen.getByRole("button", {
      name: direction,
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(replace).not.toHaveBeenCalled();
    expect(eventRequests()).toHaveLength(1);
  },
);
it("does not navigate from a valid Day to an unsupported Week or Agenda range", async () => {
  runtimeProcess.env.TZ = "UTC";
  render(<CalendarPlanner initialDate="9999-12-30" initialView="day" />);
  await screen.findByText("No events in this range");
  for (const view of ["Week", "Agenda"]) {
    const button = screen.getByRole("button", {
      name: view,
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
  }
  await waitFor(() => expect(eventRequests()).toHaveLength(1));
  expect(replace).not.toHaveBeenCalled();
});
