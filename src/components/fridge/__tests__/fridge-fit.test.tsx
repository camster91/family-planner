/**
 * @jest-environment jsdom
 */
// Fridge board fit (owner decision 2026-11-19): never hide rows silently.
// A card shows what fits and an honest "+N more" that matches the count;
// cards are sized to their content; a portrait tablet (800x1280) fits one
// screen with "Use soon" and "Coming up" visible. First names only.
import "@testing-library/jest-dom";
import * as React from "react";
import { act, render, screen, within } from "@testing-library/react";
import { I18nProvider } from "@/i18n";
import { ToastProvider } from "@/components/ui/toast";
import TodayBoard, { boardGridClass, FRIDGE_LIMITS } from "../TodayBoard";
import { allotRows, ChoresRegion, DinnerRegion, GroceriesRegion } from "../regions";
import type { TodayBoardData } from "@/app/dashboard/today/today-board-data";
import type { PersonChores } from "../board-model";

jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn() }) }));

const NOW = new Date(2026, 0, 5, 12, 0, 0);
const TODAY = "2026-01-05";
const at = (h: number, m = 0) => new Date(2026, 0, 5, h, m, 0).toISOString();

const items = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `i${i}`,
    content: `Item ${i + 1}`,
    quantity: 1,
    listId: "l1",
    listName: "Groceries",
  }));

function chore(id: string, assigneeId: string) {
  return { id, title: `Chore ${id}`, dueDay: TODAY, status: "pending", assigneeId };
}

function data(overrides: Partial<TodayBoardData> = {}): TodayBoardData {
  return {
    generatedAt: NOW.toISOString(),
    members: [
      { id: "p", name: "Avery Parent", color: "purple" },
      { id: "c", name: "Casey Child", color: "green" },
    ],
    events: Array.from({ length: 5 }, (_, i) => ({
      id: `e${i}`,
      title: `Event ${i + 1}`,
      start: at(13 + i),
      end: at(13 + i, 30),
      isTask: false,
      source: null,
      addedById: null,
    })),
    chores: [
      ...["a", "b", "c", "d", "e", "f"].map((id) => chore(id, "c")),
      chore("g", "p"),
    ],
    dinners: [
      { id: "d1", day: TODAY, recipeName: "Tacos", cookName: "Avery Parent" },
    ],
    shopping: { items: items(5), total: 6 },
    links: { calendar: null, chores: null, meals: null, lists: null, features: null },
    weather: null,
    ...overrides,
  };
}

function mockOrientation(kind: "landscape" | "portrait" | null) {
  window.matchMedia = jest.fn((query: string) => ({
    matches:
      kind === "landscape"
        ? query.includes("landscape")
        : kind === "portrait"
          ? query.includes("portrait")
          : false,
    media: query,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  })) as unknown as typeof window.matchMedia;
}

async function renderBoard(props: Partial<React.ComponentProps<typeof TodayBoard>> = {}) {
  jest.useFakeTimers({ now: NOW });
  const utils = render(
    <ToastProvider>
      <I18nProvider locale="en">
        <TodayBoard data={data()} fridgeMode checkVersion={async () => "v1"} {...props} />
      </I18nProvider>
    </ToastProvider>,
  );
  await act(async () => {
    jest.advanceTimersByTime(0);
  });
  return utils;
}

const original = window.matchMedia;
afterEach(() => {
  jest.useRealTimers();
  window.matchMedia = original;
});

describe("allotRows", () => {
  it("gives everyone with chores a row, then shares the rest round-robin", () => {
    expect(allotRows([6, 1], 4)).toEqual([3, 1]);
    expect(allotRows([0, 3], 2)).toEqual([0, 2]);
    expect(allotRows([2, 2], 10)).toEqual([2, 2]);
    // Never fewer rows than people with chores.
    expect(allotRows([3, 3, 3], 2)).toEqual([1, 1, 1]);
  });

  it("budgets fewer rows in portrait than in landscape", () => {
    expect(FRIDGE_LIMITS.landscape.choreRows!(2, false)).toBe(6);
    expect(FRIDGE_LIMITS.portrait.choreRows!(2, false)).toBe(3);
    // "Use soon" on the same screen leaves fewer chore rows, never fewer than one per person.
    expect(FRIDGE_LIMITS.landscape.choreRows!(2, true)).toBe(3);
    expect(FRIDGE_LIMITS.portrait.choreRows!(3, true)).toBe(3);
    const portraitToday = FRIDGE_LIMITS.portrait.today as (crowded: boolean) => number;
    expect(portraitToday(false)).toBeLessThan(FRIDGE_LIMITS.landscape.today as number);
    expect(portraitToday(true)).toBeLessThan(portraitToday(false));
  });
});

describe('honest "+N more"', () => {
  it('"6 to buy" shows 4 rows and "+2 more" on the fridge', () => {
    render(<GroceriesRegion shopping={{ items: items(5), total: 6 }} listsHref={null} maxRows={4} />);
    expect(screen.getByText("6 to buy")).toBeInTheDocument();
    expect(screen.getAllByTestId("grocery-item")).toHaveLength(4);
    expect(screen.getByTestId("grocery-more")).toHaveTextContent("+2 more");
  });

  it("keeps the phone board's preview and link as before", () => {
    render(<GroceriesRegion shopping={{ items: items(5), total: 6 }} listsHref="/dashboard/lists" />);
    expect(screen.getAllByTestId("grocery-item")).toHaveLength(5);
    expect(screen.getByRole("link", { name: "1 more to buy" })).toBeInTheDocument();
  });

  it("shows no overflow line when everything fits", () => {
    render(<GroceriesRegion shopping={{ items: items(3), total: 3 }} listsHref={null} maxRows={4} />);
    expect(screen.getAllByTestId("grocery-item")).toHaveLength(3);
    expect(screen.queryByTestId("grocery-more")).toBeNull();
  });

  it("splits the chore budget between people with exact per-person counts", () => {
    const people: PersonChores[] = [
      {
        member: { id: "c", name: "Casey Child", color: "green" },
        open: ["a", "b", "c", "d", "e", "f"].map((id) => chore(id, "c")),
        doneCount: 0,
        awaitingCheckCount: 0,
      },
      {
        member: { id: "p", name: "Avery Parent", color: "purple" },
        open: [chore("g", "p")],
        doneCount: 0,
        awaitingCheckCount: 0,
      },
    ];
    render(<ChoresRegion people={people} choresHref={null} rowBudget={4} />);
    const [casey, avery] = screen.getAllByTestId("chore-person");
    expect(within(casey).getAllByTestId("board-chore")).toHaveLength(3);
    expect(within(casey).getByTestId("chore-more")).toHaveTextContent("+3 more");
    expect(within(avery).getAllByTestId("board-chore")).toHaveLength(1);
    expect(within(avery).queryByTestId("chore-more")).toBeNull();
    // First names only on the shared board.
    expect(within(casey).getByRole("heading", { name: "Casey" })).toBeInTheDocument();
    expect(screen.queryByText(/Child|Parent/)).toBeNull();
  });
});

describe("fridge board fit", () => {
  it("portrait tablet: fits one screen, two columns, Use soon and Coming up in their own rows", async () => {
    mockOrientation("portrait");
    await renderBoard();
    const grid = screen.getByTestId("board-grid");
    expect(grid.className).toContain('md:portrait:[grid-template-areas:"today_chores"_"dinner_groceries"_"coming_coming"]');
    expect(grid.className).toContain("md:portrait:grid-rows-[minmax(0,1fr)_auto_auto]");
    expect(screen.getByTestId("today-board").className).toContain("md:portrait:h-dvh");
    // Tighter rows, each with an exact count of what is left.
    expect(screen.getAllByTestId("today-event")).toHaveLength(3);
    expect(screen.getByTestId("today-more")).toHaveTextContent("2 more later today");
    expect(screen.getAllByTestId("grocery-item")).toHaveLength(4);
    expect(screen.getByTestId("grocery-more")).toHaveTextContent("+2 more");
    const rows = screen.getAllByTestId("board-chore");
    const more = screen.getAllByTestId("chore-more");
    // 7 chores in all: the shown rows plus every "+N more" add up to 7.
    const hidden = more.reduce((sum, el) => sum + Number(el.textContent!.replace(/\D/g, "")), 0);
    expect(rows.length + hidden).toBe(7);
    expect(rows.length).toBe(FRIDGE_LIMITS.portrait.choreRows!(2, false));
    expect(within(screen.getByTestId("region-coming")).getByRole("heading", { name: "Coming up" })).toBeInTheDocument();
  });

  it("portrait grid puts Use soon beside Groceries above Coming up", () => {
    expect(boardGridClass(true, true)).toContain(
      'md:portrait:[grid-template-areas:"today_chores"_"dinner_groceries"_"usesoon_groceries"_"coming_coming"]',
    );
    expect(boardGridClass(true, true)).toContain("lg:portrait:grid-rows-[minmax(0,1fr)_auto_auto_auto]");
    // The person app is untouched.
    expect(boardGridClass(false, true)).not.toContain("portrait");
  });

  it("landscape hub: cards are sized to their content instead of fixed row fractions", async () => {
    mockOrientation("landscape");
    await renderBoard();
    const grid = screen.getByTestId("board-grid").className;
    expect(grid).toContain("lg:landscape:grid-rows-[auto_minmax(0,1fr)]");
    expect(grid).toContain("lg:landscape:[&>*]:self-start");
    expect(grid).toContain("lg:landscape:[&>*]:max-h-full");
    expect(grid).not.toContain("minmax(0,2fr)");
    expect(screen.getAllByTestId("today-event")).toHaveLength(5);
    expect(screen.queryByTestId("today-more")).toBeNull();
    expect(screen.getAllByTestId("grocery-item")).toHaveLength(4);
    expect(screen.getByTestId("grocery-more")).toHaveTextContent("+2 more");
  });

  it("the person app board keeps its own preview rules", async () => {
    mockOrientation("portrait");
    await renderBoard({ fridgeMode: false });
    expect(screen.queryByTestId("grocery-more")?.textContent ?? "").not.toContain("+");
  });

  it("names the cook by first name only", () => {
    render(
      <DinnerRegion
        dinner={{ id: "d1", day: TODAY, recipeName: "Tacos", cookName: "Avery Fixture-A" }}
        mealsEnabled
        mealsHref={null}
        featuresHref={null}
      />,
    );
    expect(screen.getByTestId("dinner-cook")).toHaveTextContent("Cooking: Avery");
    expect(screen.queryByText(/Fixture-A/)).toBeNull();
  });
});
