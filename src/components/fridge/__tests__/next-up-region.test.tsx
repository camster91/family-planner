/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "@/i18n";
import { NextUpRegion } from "../NextUpRegion";
import type { BoardChore } from "@/app/dashboard/today/today-board-data";
import type { TodayEvent } from "../board-model";

jest.mock("@/components/calendar/preparation/PreparationEntry", () => ({
  PreparationEntry: ({
    eventId,
    backlink,
  }: {
    eventId: string;
    backlink?: boolean;
  }) => (
    <button type="button">
      {backlink ? "Backlink" : "Prepare"} {eventId}
    </button>
  ),
}));

const member = { id: "a", name: "Avery", color: "purple" as const };
const chore = (id: string): BoardChore => ({
  id,
  title: `Chore ${id}`,
  status: "pending",
  dueDay: "2026-01-05",
  assigneeId: "a",
});
const event = (id: string): TodayEvent => ({
  id,
  title: `Event ${id}`,
  start: "2026-01-05T14:00:00.000Z",
  end: "2026-01-05T15:00:00.000Z",
  isTask: false,
  source: null,
  happeningNow: false,
  startedEarlier: false,
});
function show(
  props: Partial<React.ComponentProps<typeof NextUpRegion>> = {},
  locale: "en" | "es" = "en",
) {
  return render(
    <I18nProvider locale={locale}>
      <NextUpRegion
        events={[]}
        people={new Map([["a", member]])}
        chores={[]}
        showChores
        calendarHref="/dashboard/calendar"
        choresHref="/dashboard/chores"
        {...props}
      />
    </I18nProvider>,
  );
}
beforeEach(() => localStorage.clear());

it("caps the combined view, keeps room for both kinds, and exposes exact continuation counts", () => {
  show({
    events: Array.from({ length: 7 }, (_, i) => event(String(i))),
    chores: [
      {
        member,
        open: Array.from({ length: 7 }, (_, i) => chore(String(i))),
        doneCount: 2,
        awaitingCheckCount: 1,
      },
    ],
  });
  expect(screen.getAllByTestId("today-event")).toHaveLength(3);
  expect(screen.getAllByTestId("board-chore")).toHaveLength(3);
  expect(screen.getByText("4 more later today")).toBeVisible();
  expect(screen.getByText("4 more")).toBeVisible();
  expect(screen.getByTestId("chore-done")).toHaveTextContent(
    "2 done · 1 waiting for a parent's check",
  );
  expect(screen.getByRole("link", { name: "Calendar" })).toHaveAttribute(
    "href",
    "/dashboard/calendar",
  );
  expect(screen.getByRole("link", { name: /Chores today/ })).toHaveAttribute(
    "href",
    "/dashboard/chores",
  );
});

it("uses spare capacity for events without resurrecting chores already shown in the personal summary", () => {
  show({
    events: Array.from({ length: 7 }, (_, i) => event(String(i))),
    showChores: false,
    chores: [
      { member, open: [chore("hidden")], doneCount: 0, awaitingCheckCount: 0 },
    ],
  });
  expect(screen.getAllByTestId("today-event")).toHaveLength(6);
  expect(screen.queryByTestId("region-chores")).not.toBeInTheDocument();
  expect(screen.queryByText("Chore hidden")).not.toBeInTheDocument();
  expect(screen.getByText("1 more later today")).toBeVisible();
});

it("keeps role/action restrictions and paused profile state on the shared chore row", async () => {
  const allowed = chore("allowed");
  const paused: BoardChore = {
    ...chore("paused"),
    actionAvailability: {
      state: "paused",
      reason: "RECURRENCE_CAPABILITY_UNAVAILABLE",
      recovery: "refresh-and-retain-pending",
      requiresCompatibleClient: true,
      actions: { complete: false, undo: false, verify: false, reject: false },
    },
  };
  const onTick = jest.fn();
  show({
    chores: [
      { member, open: [allowed, paused], doneCount: 0, awaitingCheckCount: 0 },
    ],
    onTick,
    canTick: (item) => item.id === allowed.id,
    calendarHref: null,
    choresHref: null,
  });
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  expect(screen.getByText(/recurring profile chore is paused/)).toBeVisible();
  expect(screen.getAllByRole("button")).toHaveLength(1);
  await userEvent
    .setup()
    .click(
      screen.getByRole("button", { name: "Mark Chore allowed done, Avery" }),
    );
  expect(onTick).toHaveBeenCalledTimes(1);
  expect(onTick).toHaveBeenCalledWith(allowed);
});

it("has a localized honest empty state without changing source data", () => {
  show({}, "es");
  expect(screen.getByRole("heading", { name: "A continuación" })).toBeVisible();
  expect(
    screen.getByText(
      "No hay más eventos ni tareas del hogar que mostrar aquí.",
    ),
  ).toBeVisible();
  expect(screen.getByRole("link", { name: "Calendario" })).toHaveAttribute(
    "href",
    "/dashboard/calendar",
  );
});

it("fills mixed capacity without losing a small category", () => {
  show({
    events: Array.from({ length: 5 }, (_, i) => event(String(i))),
    chores: [
      { member, open: [chore("only")], doneCount: 0, awaitingCheckCount: 0 },
    ],
  });
  expect(screen.getAllByTestId("today-event")).toHaveLength(5);
  expect(screen.getAllByTestId("board-chore")).toHaveLength(1);
  expect(screen.queryByText(/more later today/)).not.toBeInTheDocument();
});
it("retains done-only progress and waiting approvals instead of a false empty state", () => {
  show({ chores: [{ member, open: [], doneCount: 3, awaitingCheckCount: 1 }] });
  expect(screen.getByTestId("chore-done")).toHaveTextContent(
    "3 done · 1 waiting for a parent's check",
  );
  expect(
    screen.queryByText("No more events or household chores to show here."),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Chores today/ })).toHaveAttribute(
    "href",
    "/dashboard/chores",
  );
});

// Authored for the deferred consolidated pass; not executed during implementation.
it("omits personal preparation by default even if a relationship prop is supplied", () => {
  show({
    events: [event("event-a")],
    preparationBacklinks: { "task-a": "event-a" },
    chores: [{ member, open: [chore("task-a")], doneCount: 0, awaitingCheckCount: 0 }],
  });
  expect(
    screen.queryByRole("button", { name: /Prepare|Backlink/ }),
  ).not.toBeInTheDocument();
});
it("keeps preparation navigation outside the canonical chore completion button", async () => {
  const onTick = jest.fn();
  show({
    preparationEnabled: true,
    events: [event("event-a")],
    preparationBacklinks: { "task-a": "event-a" },
    chores: [{ member, open: [chore("task-a")], doneCount: 0, awaitingCheckCount: 0 }],
    onTick,
  });
  expect(screen.getByRole("button", { name: "Prepare event-a" })).toBeVisible();
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Backlink event-a" }));
  expect(onTick).not.toHaveBeenCalled();
  await userEvent
    .setup()
    .click(
      screen.getByRole("button", { name: "Mark Chore task-a done, Avery" }),
    );
  expect(onTick).toHaveBeenCalledTimes(1);
});
