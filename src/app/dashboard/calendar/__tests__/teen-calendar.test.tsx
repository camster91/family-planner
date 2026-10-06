/** @jest-environment jsdom */
import * as React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { CalendarPlanner } from "../CalendarPlanner";
jest.mock("../calendar-planner.module.css", () => ({}));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: jest.fn() }),
}));
const events = [
  {
    id: "local",
    title: "Local event",
    start_time: "2026-01-05T10:00:00Z",
    end_time: "2026-01-05T11:00:00Z",
    event_type: "other",
  },
  {
    id: "provider",
    title: "Provider event",
    start_time: "2026-01-05T12:00:00Z",
    end_time: "2026-01-05T13:00:00Z",
    event_type: "other",
    source: null,
    source_connection_id: "private",
  },
  {
    id: "ics",
    title: "ICS event",
    start_time: "2026-01-05T14:00:00Z",
    end_time: "2026-01-05T15:00:00Z",
    event_type: "other",
    source_subscription_id: "subscription",
    source: { subscription_id: "subscription", name: "School", color: null },
  },
];
beforeEach(() => {
  global.fetch = jest.fn(async (url) => ({
    ok: true,
    json: async () =>
      String(url).includes("subscriptions")
        ? { subscriptions: [] }
        : { events, hasMore: false, nextCursor: null },
  })) as jest.Mock;
});
it.each([false, true])(
  "shows detail for every origin; canEdit=%s controls real editor links",
  async (canEdit) => {
    render(
      <CalendarPlanner
        initialDate="2026-01-05"
        initialView="agenda"
        canEditEvents={canEdit}
      />,
    );
    await screen.findByRole("button", { name: /Local event/ });
    for (const name of ["Local event", "Provider event", "ICS event"]) {
      fireEvent.click(screen.getByRole("button", { name: new RegExp(name) }));
      expect(screen.getByRole("dialog")).toBeTruthy();
      const edit = screen.queryByRole("link", { name: "Edit event" });
      if (canEdit && name !== "ICS event") expect(edit).not.toBeNull();
      else expect(edit).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Close details" }));
    }
    expect(
      (global.fetch as jest.Mock).mock.calls.every(
        ([url]) => !String(url).includes("connections"),
      ),
    ).toBe(true);
  },
);
