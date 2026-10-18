/** @jest-environment jsdom */
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

const events = [
  {
    id: "local",
    title: "Dentist",
    start_time: "2026-01-05T09:00:00Z",
    end_time: "2026-01-05T11:00:00Z",
    event_type: "other",
  },
  {
    id: "school",
    title: "School assembly",
    start_time: "2026-01-05T10:00:00Z",
    end_time: "2026-01-05T12:00:00Z",
    event_type: "other",
    source_subscription_id: "school",
    source: { subscription_id: "school", name: "School", color: null },
  },
];
beforeEach(() => {
  localStorage.clear();
  window.matchMedia = jest
    .fn()
    .mockReturnValue({
      matches: false,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    });
  global.fetch = jest.fn(async (url) => ({
    ok: true,
    json: async () =>
      String(url).includes("subscriptions")
        ? { subscriptions: [{ id: "school", name: "School", color: null }] }
        : { events, hasMore: false },
  })) as jest.Mock;
});

it("reviews actual overlaps through the existing details and edit permission", async () => {
  render(<CalendarPlanner initialDate="2026-01-05" canEditEvents />);
  const panel = await screen.findByTestId("calendar-overlaps");
  expect(panel).not.toHaveAttribute("open");
  expect(within(panel).getByText("1 overlap")).toBeInTheDocument();
  await userEvent.click(panel.querySelector("summary")!);
  const review = within(panel).getByRole("button", { name: "Review Dentist" });
  await userEvent.click(review);
  expect(
    within(screen.getByRole("dialog")).getByRole("link", {
      name: "Edit event",
    }),
  ).toHaveAttribute("href", "/dashboard/calendar/edit?id=local");
  await userEvent.click(screen.getByRole("button", { name: "Close details" }));
  expect(review).toHaveFocus();
  await userEvent.click(
    within(panel).getByRole("button", { name: "Review School assembly" }),
  );
  expect(
    within(screen.getByRole("dialog")).queryByRole("link", {
      name: "Edit event",
    }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByText(/Changes belong in the original subscription calendar/),
  ).toBeInTheDocument();
});

it("keeps teen-style read-only details and recomputes for the selected source", async () => {
  render(<CalendarPlanner initialDate="2026-01-05" canEditEvents={false} />);
  const panel = await screen.findByTestId("calendar-overlaps");
  await userEvent.click(panel.querySelector("summary")!);
  await userEvent.click(
    within(panel).getByRole("button", { name: "Review Dentist" }),
  );
  expect(
    within(screen.getByRole("dialog")).queryByRole("link", {
      name: "Edit event",
    }),
  ).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Close details" }));
  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "Calendar source" }),
    "local",
  );
  expect(screen.queryByTestId("calendar-overlaps")).not.toBeInTheDocument();
});

it("localizes the advisory and its detail action in Spanish", async () => {
  render(
    <I18nProvider locale="es">
      <CalendarPlanner initialDate="2026-01-05" />
    </I18nProvider>,
  );
  const panel = await screen.findByTestId("calendar-overlaps");
  expect(within(panel).getByText("A la misma hora")).toBeInTheDocument();
  expect(within(panel).getByText("1 coincidencia")).toBeInTheDocument();
  await userEvent.click(panel.querySelector("summary")!);
  expect(
    within(panel).getByRole("button", { name: "Revisar Dentist" }),
  ).toBeInTheDocument();
});
