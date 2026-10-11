/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import * as React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { I18nProvider, useTranslation } from "@/i18n";
import type { BoardEvent } from "@/app/dashboard/today/today-board-data";
import {
  ChoresRegion,
  ComingUpRegion,
  DinnerRegion,
  GroceriesRegion,
  ScheduleRegion,
} from "../regions";

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
jest.mock("@/components/ui/use-display-locale", () => ({
  useDisplayLocale: () => "en-CA",
}));

const event: BoardEvent = {
  id: "event-1",
  title: "School pickup",
  start: "2026-01-05T18:00:00.000Z",
  end: "2026-01-05T19:00:00.000Z",
  isTask: true,
  source: { name: "School", color: "#0079A8" },
  addedById: "parent",
};

function LocaleSwitch() {
  const { setLocale } = useTranslation();
  return (
    <button type="button" onClick={() => setLocale("es")}>
      Switch language
    </button>
  );
}

function renderRegions() {
  return render(
    <I18nProvider locale="en">
      <LocaleSwitch />
      <ScheduleRegion
        events={[{ ...event, happeningNow: false, startedEarlier: false }]}
        calendarHref="/dashboard/calendar"
        people={
          new Map([["parent", { name: "Avery", color: "purple" as const }]])
        }
      />
      <DinnerRegion
        dinner={{
          id: "dinner",
          day: "2026-01-05",
          recipeName: "Taco night",
          recipeTitle: "Tacos",
          prepMinutes: 20,
          cookName: "Avery",
          missingIngredients: 2,
        }}
        mealsEnabled
        mealsHref="/dashboard/meals"
        featuresHref="/dashboard/features"
      />
      <GroceriesRegion
        shopping={{
          items: [
            {
              id: "item",
              content: "Milk",
              quantity: 2,
              listId: "list",
              listName: "Groceries",
            },
          ],
          total: 3,
        }}
        listsHref="/dashboard/lists"
      />
      <ChoresRegion
        people={[
          {
            member: { id: "child", name: "Casey", color: "green" },
            open: [
              {
                id: "chore",
                title: "Pack bag",
                dueDay: "2026-01-05",
                status: "in_progress",
                assigneeId: "child",
              },
            ],
            doneCount: 1,
            awaitingCheckCount: 1,
          },
        ]}
        choresHref="/dashboard/chores"
        onTick={() => {}}
      />
      <ComingUpRegion
        days={[
          {
            dayKey: "2026-01-06",
            label: "Tomorrow",
            dateLabel: "Jan 6",
            events: [],
            dinner: null,
          },
        ]}
        mealsEnabled
      />
    </I18nProvider>,
  );
}

it("renders the localized board regions while preserving household values and links", () => {
  renderRegions();
  expect(screen.getByRole("heading", { name: /Today/ })).toBeInTheDocument();
  expect(screen.getByText("School pickup")).toBeInTheDocument();
  expect(screen.getByText("From School")).toBeInTheDocument();
  expect(screen.getByText("Recipe: Tacos · Prep 20 min")).toBeInTheDocument();
  expect(screen.getByText("Cooking: Avery")).toBeInTheDocument();
  expect(screen.getByText("3 to buy")).toBeInTheDocument();
  expect(screen.getByText("In progress")).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Mark Pack bag done, Casey" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Tomorrow")).toBeInTheDocument();
  expect(
    within(screen.getByTestId("region-groceries")).getByRole("link", {
      name: "All shared lists",
    }),
  ).toHaveAttribute("href", "/dashboard/lists");
});

it("switches every board region to Spanish without translating inserted household values", () => {
  renderRegions();
  fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
  expect(screen.getByRole("heading", { name: /Hoy/ })).toBeInTheDocument();
  expect(screen.getByText("De School")).toBeInTheDocument();
  expect(
    screen.getByText("Receta: Tacos · Preparación 20 min"),
  ).toBeInTheDocument();
  expect(screen.getByText("Cocina: Avery")).toBeInTheDocument();
  expect(screen.getByText("3 por comprar")).toBeInTheDocument();
  expect(screen.getByText("En curso")).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Marcar Pack bag como hecha, Casey" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Mañana")).toBeInTheDocument();
  expect(screen.queryByText("Escuela")).not.toBeInTheDocument();
});
