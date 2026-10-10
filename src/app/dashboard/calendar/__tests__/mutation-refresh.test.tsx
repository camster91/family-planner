/** @jest-environment jsdom */
import * as React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom";
import { CalendarPlanner } from "../CalendarPlanner";
import CreateEventForm from "../create/CreateEventForm";
import EditEventForm from "../edit/EditEventForm";
import { notifyCalendarChanged } from "@/lib/calendar-planning/changes";

const mockBack = jest.fn();
const mockPush = jest.fn();
jest.mock("../calendar-planner.module.css", () => ({}));
jest.mock("next/navigation", () => ({
  useRouter: () => ({
    back: mockBack,
    push: mockPush,
    replace: jest.fn(),
    refresh: jest.fn(),
  }),
  useSearchParams: () => new URLSearchParams("id=saved-event"),
}));
const event = {
  id: "saved-event",
  title: "New family event",
  start_time: "2099-12-15T12:00:00Z",
  end_time: "2099-12-15T12:30:00Z",
  event_type: "other",
  source: null,
  source_connection_id: null,
};
let committed: boolean;
let succeeds: boolean;
let reads: number;
let currentEvent: typeof event;
beforeEach(() => {
  mockBack.mockClear();
  mockPush.mockClear();
  committed = false;
  succeeds = true;
  reads = 0;
  currentEvent = { ...event };
  window.matchMedia = jest.fn().mockReturnValue({ matches: true });
  global.fetch = jest.fn(async (url, options) => {
    if (String(url) === "/api/auth/me")
      return { ok: true, json: async () => ({ user: { role: "parent" } }) };
    if (String(url).startsWith("/api/events?id="))
      return { ok: true, json: async () => ({ event: currentEvent }) };
    if (options?.method === "PATCH") {
      if (succeeds)
        currentEvent = { ...currentEvent, ...JSON.parse(String(options.body)) };
      return {
        ok: succeeds,
        json: async () =>
          succeeds
            ? { event: currentEvent }
            : { error: "Could not save fixture" },
      };
    }
    if (options?.method === "DELETE") {
      if (succeeds) committed = false;
      return {
        ok: succeeds,
        json: async () =>
          succeeds ? { success: true } : { error: "Could not delete fixture" },
      };
    }
    if (options?.method === "POST") {
      if (succeeds) committed = true;
      return {
        ok: succeeds,
        json: async () =>
          succeeds ? { event } : { error: "Could not save fixture" },
      };
    }
    if (String(url).includes("subscriptions"))
      return { ok: true, json: async () => ({ subscriptions: [] }) };
    reads += 1;
    return {
      ok: true,
      json: async () => ({
        events: committed ? [currentEvent] : [],
        hasMore: false,
        nextCursor: null,
      }),
    };
  }) as jest.Mock;
});
function fillAndSubmit() {
  fireEvent.change(screen.getByLabelText("Title"), {
    target: { value: event.title },
  });
  fireEvent.change(screen.getByLabelText("Start"), {
    target: { value: "2099-12-15" },
  });
  fireEvent.submit(
    screen.getByRole("button", { name: "Create Event" }).closest("form")!,
  );
}
it("shows a successful sheet-created event in the already mounted Calendar when the sheet reports a committed change", async () => {
  render(
    <>
      <CalendarPlanner initialDate="2099-12-15" initialView="agenda" />
      <CreateEventForm inSheet />
    </>,
  );
  await screen.findAllByText("No events this day");
  const before = reads;
  fillAndSubmit();
  expect(
    await screen.findByRole("button", { name: /New family event/ }),
  ).toBeInTheDocument();
  expect(reads).toBeGreaterThan(before);
  expect(mockBack).toHaveBeenCalledTimes(1);
  expect(mockPush).not.toHaveBeenCalled();
});
it("does not announce a failed save as a calendar change", async () => {
  succeeds = false;
  render(
    <>
      <CalendarPlanner initialDate="2099-12-15" initialView="agenda" />
      <CreateEventForm inSheet />
    </>,
  );
  await waitFor(() => expect(reads).toBeGreaterThan(0));
  const before = reads;
  fillAndSubmit();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not save fixture",
  );
  expect(reads).toBe(before);
  expect(
    screen.queryByRole("button", { name: /New family event/ }),
  ).not.toBeInTheDocument();
});
it("reconciles a committed deletion and stops listening when the view unmounts", async () => {
  committed = true;
  const view = render(
    <CalendarPlanner initialDate="2099-12-15" initialView="agenda" />,
  );
  await screen.findByRole("button", { name: /New family event/ });
  committed = false;
  act(() => notifyCalendarChanged());
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: /New family event/ }),
    ).not.toBeInTheDocument(),
  );
  await waitFor(() => expect(reads).toBeGreaterThan(1));
  view.unmount();
  const before = reads;
  act(() => notifyCalendarChanged());
  expect(reads).toBe(before);
});

it("shows an edited event in the mounted Calendar immediately after confirmed save", async () => {
  committed = true;
  render(
    <>
      <CalendarPlanner initialDate="2099-12-15" initialView="agenda" />
      <EditEventForm inSheet />
    </>,
  );
  await screen.findByRole("button", { name: /New family event/ });
  await screen.findByDisplayValue(event.title);
  fireEvent.change(screen.getByLabelText("Title"), {
    target: { value: "Updated family event" },
  });
  fireEvent.submit(
    screen.getByRole("button", { name: "Save Changes" }).closest("form")!,
  );
  expect(
    await screen.findByRole("button", { name: /Updated family event/ }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /New family event/ }),
  ).not.toBeInTheDocument();
});
it("removes a deleted event from the mounted Calendar after explicit confirmation", async () => {
  committed = true;
  render(
    <>
      <CalendarPlanner initialDate="2099-12-15" initialView="agenda" />
      <EditEventForm inSheet />
    </>,
  );
  await screen.findByRole("button", { name: /New family event/ });
  fireEvent.click(await screen.findByRole("button", { name: "Delete event" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: /New family event/ }),
    ).not.toBeInTheDocument(),
  );
  expect(committed).toBe(false);
});

it.each(["save", "delete"])(
  "keeps the mounted range unchanged after a failed edit %s",
  async (action) => {
    committed = true;
    succeeds = false;
    render(
      <>
        <CalendarPlanner initialDate="2099-12-15" initialView="agenda" />
        <EditEventForm inSheet />
      </>,
    );
    await screen.findByRole("button", { name: /New family event/ });
    await screen.findByDisplayValue(event.title);
    const before = reads;
    if (action === "save") {
      fireEvent.submit(
        screen.getByRole("button", { name: "Save Changes" }).closest("form")!,
      );
    } else {
      fireEvent.click(screen.getByRole("button", { name: "Delete event" }));
      fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    }
    await screen.findByText(
      action === "save" ? "Could not save fixture" : "Could not delete fixture",
    );
    expect(reads).toBe(before);
    expect(
      screen.getByRole("button", { name: /New family event/ }),
    ).toBeInTheDocument();
  },
);

it('closes event details before navigating to the intercepted edit form', async () => {
  committed = true
  render(<CalendarPlanner initialDate="2099-12-15" initialView="agenda" canEditEvents />)
  fireEvent.click(await screen.findByRole('button', { name: /New family event/ }))
  expect(screen.getByRole('dialog', { name: 'New family event' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('link', { name: 'Edit event' }))
  expect(screen.queryByRole('dialog', { name: 'New family event' })).toBeNull()
})
