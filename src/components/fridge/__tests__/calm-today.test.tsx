/**
 * @jest-environment jsdom
 */
// Calm Today (owner-approved): the personal Today page is one short "what's
// next" view. Today's events and chores are the main card; Dinner, Groceries
// and Coming up are single tappable lines; "Added by" is gone from event
// rows; Customize and Fridge mode sit in a quiet overflow. Fridge mode and
// the paired tablet keep their full boards.
import "@testing-library/jest-dom";
import * as React from "react";
import { act, render, screen, within } from "@testing-library/react";
import TodayBoard from "../TodayBoard";
import { NextUpRegion } from "../NextUpRegion";
import { RegionLine } from "../regions";
import { comingUp, comingUpSummary, type TodayEvent } from "../board-model";
import { ToastProvider } from "@/components/ui/toast";
import type { TodayBoardData } from "@/app/dashboard/today/today-board-data";
import { I18nProvider } from "@/i18n";
import {
  defaultPersonalLayout,
  type TodayLayout,
} from "@/lib/personal-layout";
import { UtensilsCrossed } from "lucide-react";

const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
jest.mock("@/lib/person-queue-browser", () => ({
  getPersonQueue: () => ({
    ready: Promise.resolve(),
    list: () => [],
    subscribe: () => () => undefined,
    hasStorageReadError: () => false,
  }),
}));
jest.mock("@/components/calendar/preparation/PreparationEntry", () => ({
  PreparationEntry: () => null,
}));

let layout: TodayLayout = defaultPersonalLayout().today;
jest.mock("@/components/providers/display-preferences-provider", () => ({
  useDisplayPreferences: () => ({
    today: layout,
    saving: false,
    syncState: "ready",
  }),
}));
jest.mock("@/components/account/DisplayPreferencesStatus", () => ({
  __esModule: true,
  default: () => null,
}));

// Local noon on Monday 5 January 2026 in whatever zone the test runs in.
const NOW = new Date(2026, 0, 5, 12, 0, 0);
const TODAY = "2026-01-05";
const at = (day: number, hour: number) =>
  new Date(2026, 0, day, hour, 0, 0).toISOString();

function data(overrides: Partial<TodayBoardData> = {}): TodayBoardData {
  return {
    generatedAt: NOW.toISOString(),
    version: "v1",
    members: [
      { id: "p", name: "Avery Parent", color: "purple" },
      { id: "c", name: "Casey Child", color: "green" },
    ],
    events: [
      {
        id: "e2",
        title: "Soccer practice",
        start: at(5, 17),
        end: at(5, 18),
        isTask: false,
        source: null,
        addedById: "p",
      },
      {
        id: "e1",
        title: "Dentist",
        start: at(5, 15),
        end: at(5, 16),
        isTask: false,
        source: null,
        addedById: "p",
        forPeople: [{ name: "Casey Child", color: "green" }],
      },
      {
        id: "e3",
        title: "Library returns",
        start: at(6, 9),
        end: at(6, 10),
        isTask: false,
        source: null,
        addedById: "p",
      },
      {
        id: "e4",
        title: "Swim lesson",
        start: at(7, 9),
        end: at(7, 10),
        isTask: false,
        source: null,
        addedById: "p",
      },
      {
        id: "e5",
        title: "Book club",
        start: at(7, 19),
        end: at(7, 20),
        isTask: false,
        source: null,
        addedById: "p",
      },
    ],
    chores: [
      {
        id: "c1",
        title: "Feed the cat",
        dueDay: TODAY,
        status: "pending",
        assigneeId: "c",
      },
      {
        id: "c0",
        title: "Mow the lawn",
        dueDay: "2026-01-03",
        status: "pending",
        assigneeId: "c",
        overdue: true,
      },
    ],
    dinners: [
      {
        id: "d1",
        day: TODAY,
        recipeName: "Lemon herb chicken",
        cookName: "Avery Parent",
      },
    ],
    shopping: {
      items: [
        {
          id: "i1",
          content: "Milk",
          quantity: 1,
          listId: "l1",
          listName: "Groceries",
        },
      ],
      total: 6,
    },
    links: {
      calendar: "/dashboard/calendar",
      chores: "/dashboard/chores",
      meals: "/dashboard/meals",
      lists: "/dashboard/lists",
      features: "/dashboard/features",
    },
    weather: null,
    display: { idleMinutes: 0, night: null },
    ...overrides,
  } as TodayBoardData;
}

async function renderBoard(
  props: Partial<React.ComponentProps<typeof TodayBoard>> = {},
  locale: "en" | "es" = "en",
) {
  const utils = render(
    <I18nProvider locale={locale}>
      <ToastProvider>
        <TodayBoard
          data={data()}
          fridgeMode={false}
          viewer={{ id: "p", role: "parent" }}
          checkVersion={async () => "v1"}
          {...props}
        />
      </ToastProvider>
    </I18nProvider>,
  );
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return utils;
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  layout = defaultPersonalLayout().today;
});
afterEach(() => {
  jest.useRealTimers();
});

describe("personal Today: one what's-next flow", () => {
  it("shows today's events in time order, then chores, in one card", async () => {
    await renderBoard();
    const flow = screen.getByTestId("today-next");
    const events = within(flow).getAllByTestId("today-event");
    expect(events.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Dentist"),
      expect.stringContaining("Soccer practice"),
    ]);
    const chores = within(flow).getByTestId("region-chores");
    expect(
      flow.querySelector('[data-testid="region-today"]')!.compareDocumentPosition(
        chores,
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Both headings still open their sections.
    expect(
      within(flow).getByRole("link", { name: /^Today\s*, open calendar/ }),
    ).toHaveAttribute("href", "/dashboard/calendar?view=agenda");
    expect(
      within(flow).getByRole("link", { name: /^Chores today\s*, open chores/ }),
    ).toHaveAttribute("href", "/dashboard/chores");
  });

  it('drops "Added by" from event rows but keeps the "For Casey" person chip', async () => {
    await renderBoard();
    expect(screen.queryByText(/Added by/)).toBeNull();
    expect(screen.queryByTestId("event-member")).toBeNull();
    expect(screen.getByTestId("event-for")).toHaveTextContent("Casey");
  });

  it("keeps one-tap done and the Overdue label on chores", async () => {
    await renderBoard();
    const chores = screen.getByTestId("region-chores");
    expect(
      within(chores).getByRole("button", { name: /Mark done: Feed the cat/ }),
    ).toBeInTheDocument();
    expect(within(chores).getByTestId("board-chore-overdue")).toHaveTextContent(
      "Overdue",
    );
  });
});

describe("personal Today: Dinner, Groceries and Coming up are single lines", () => {
  it("folds each into one tappable line that opens its section", async () => {
    await renderBoard();

    const dinner = within(screen.getByTestId("region-dinner")).getByRole(
      "link",
    );
    expect(dinner).toHaveTextContent("Dinner tonight");
    expect(dinner).toHaveTextContent("Lemon herb chicken");
    expect(dinner).toHaveAttribute(
      "href",
      `/dashboard/meals?start=${TODAY}`,
    );

    const groceries = within(screen.getByTestId("region-groceries")).getByRole(
      "link",
    );
    expect(groceries).toHaveTextContent("Groceries");
    expect(groceries).toHaveTextContent("6 to buy");
    expect(groceries).toHaveAttribute("href", "/dashboard/lists/groceries");

    const coming = within(screen.getByTestId("region-coming")).getByRole(
      "link",
    );
    expect(coming).toHaveTextContent("Coming up");
    expect(coming).toHaveTextContent("Library returns · Tomorrow");
    expect(coming).toHaveTextContent("+2 more");
    expect(coming).toHaveAttribute("href", "/dashboard/calendar?view=agenda");

    for (const line of [dinner, groceries, coming]) {
      // One row, at least 44px tall, and nothing else to tap inside it.
      expect(line.className).toMatch(/min-h-\[52px\]/);
      expect(line.closest("section")).toHaveAttribute("data-region-line");
      expect(
        within(line.closest("section") as HTMLElement).queryByRole("button"),
      ).toBeNull();
    }
    // The full cards' extra rows are gone from the home page.
    expect(screen.queryByTestId("grocery-item")).toBeNull();
    expect(screen.queryByTestId("coming-up-day")).toBeNull();
    expect(screen.queryByTestId("dinner-cook")).toBeNull();
    expect(screen.queryByText("All shared lists")).toBeNull();
  });

  it("keeps the honest empty wording on one line with its first action", async () => {
    await renderBoard({
      data: data({
        dinners: [],
        shopping: { items: [], total: 0 },
        events: [],
      }),
    });
    const dinner = screen.getByTestId("region-dinner");
    expect(dinner).toHaveAttribute("data-empty-line");
    expect(dinner).toHaveTextContent("No dinner planned yet.");
    expect(
      within(dinner).getByRole("link", { name: "Plan dinner" }),
    ).toHaveAttribute("href", `/dashboard/meals?start=${TODAY}`);
    expect(screen.getByTestId("region-groceries")).toHaveTextContent(
      "Nothing on the grocery list yet.",
    );
    expect(screen.getByTestId("region-coming")).toHaveTextContent(
      "Nothing on the calendar for the next few days.",
    );
  });

  it("names a coming dinner when no event is coming", async () => {
    await renderBoard({
      data: data({
        events: [],
        dinners: [
          { id: "d2", day: "2026-01-07", recipeName: "Tacos", cookName: null },
        ],
      }),
    });
    const coming = within(screen.getByTestId("region-coming")).getByRole(
      "link",
    );
    expect(coming).toHaveTextContent("Dinner: Tacos · Wednesday");
    expect(coming).toHaveAttribute("href", "/dashboard/meals?start=2026-01-07");
    expect(screen.queryByTestId("region-line-more-coming")).toBeNull();
  });

  it("shows no line for a feature that is off", async () => {
    await renderBoard({
      data: data({
        dinners: null,
        shopping: null,
        links: {
          calendar: "/dashboard/calendar",
          chores: "/dashboard/chores",
          meals: null,
          lists: null,
          features: "/dashboard/features",
        },
      }),
    });
    expect(screen.queryByTestId("region-dinner")).toBeNull();
    expect(screen.queryByTestId("region-groceries")).toBeNull();
    expect(screen.getByTestId("region-coming")).toBeInTheDocument();
  });

  it("keeps a section the person hid hidden, and their saved order", async () => {
    layout = {
      ...defaultPersonalLayout().today,
      order: ["coming", "next", "groceries", "dinner", "usesoon"],
      hidden: ["dinner"],
    };
    await renderBoard();
    expect(screen.queryByTestId("region-dinner")).toBeNull();
    expect(
      Array.from(
        screen
          .getByTestId("board-grid")
          .querySelectorAll("[data-today-section]"),
      ).map((node) => node.getAttribute("data-today-section")),
    ).toEqual(["coming", "next", "groceries"]);
  });

  it("leaves chores out of the flow when the person turned them off", async () => {
    layout = { ...defaultPersonalLayout().today, includeChores: false };
    await renderBoard();
    expect(screen.queryByTestId("region-chores")).toBeNull();
    expect(screen.getAllByTestId("today-event")).toHaveLength(2);
  });

  it("uses Spanish for every line", async () => {
    await renderBoard({}, "es");
    expect(screen.getByTestId("region-dinner")).toHaveTextContent(
      "Cena de esta noche",
    );
    expect(screen.getByTestId("region-groceries")).toHaveTextContent(
      "6 por comprar",
    );
    expect(screen.getByTestId("region-coming")).toHaveTextContent(
      "Library returns · Mañana",
    );
    expect(screen.getByTestId("region-coming")).toHaveTextContent("+2 más");
    expect(screen.queryByText(/Añadido por/)).toBeNull();
  });
});

describe("personal Today: one primary button, the rest in a quiet overflow", () => {
  it("keeps Add or ask and moves Customize and Fridge mode into More options", async () => {
    await renderBoard();
    const nav = screen.getByRole("navigation", { name: "Today quick actions" });
    expect(
      Array.from(nav.querySelectorAll(":scope > button")).map(
        (button) => button.textContent,
      ),
    ).toEqual(["Add or ask"]);
    const menu = within(nav).getByTestId("today-overflow");
    expect(menu.querySelector("summary .sr-only")).toHaveTextContent(
      "More options",
    );
    expect(
      within(menu).getByRole("button", { name: "Customize Today", hidden: true }),
    ).toBeInTheDocument();
    expect(
      within(menu).getByRole("link", { name: "Fridge mode", hidden: true }),
    ).toHaveAttribute("href", "/dashboard/today?mode=fridge");
    expect(
      within(menu).getByRole("button", { name: "Refresh now", hidden: true }),
    ).toBeInTheDocument();
    // Fridge mode is no longer a prominent header pill.
    expect(
      within(screen.getByRole("banner")).queryByRole("link", {
        name: "Fridge mode",
      }),
    ).toBeNull();
  });
});

describe("fridge mode and the shared tablet keep their boards", () => {
  it("fridge mode keeps the full cards, Added by and grocery rows", async () => {
    await renderBoard({ fridgeMode: true });
    expect(screen.getByTestId("today-board")).toHaveAttribute(
      "data-mode",
      "fridge",
    );
    expect(screen.queryByTestId("today-next")).toBeNull();
    expect(screen.queryByTestId("today-overflow")).toBeNull();
    expect(document.querySelector("[data-region-line]")).toBeNull();
    expect(screen.getByTestId("event-member")).toHaveTextContent(
      "Added by Avery",
    );
    expect(screen.getByTestId("dinner-cook")).toHaveTextContent(
      "Cooking: Avery",
    );
    expect(screen.getAllByTestId("grocery-item")).toHaveLength(1);
    expect(screen.getAllByTestId("coming-up-day").length).toBeGreaterThan(0);
    expect(screen.getByTestId("chore-person")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Exit fridge mode" }),
    ).toBeInTheDocument();
  });

  it("a paired tablet (its own actions, no person) keeps the full cards", async () => {
    await renderBoard({
      fridgeMode: true,
      viewer: null,
      tileActions: {
        canCompleteChore: () => false,
        canTickGroceries: false,
        completeChore: async () => ({ ok: true }),
        setGroceryChecked: async () => ({ ok: true }),
      },
      actions: <span>Tablet actions</span>,
    });
    expect(document.querySelector("[data-region-line]")).toBeNull();
    expect(screen.getByTestId("event-member")).toHaveTextContent(
      "Added by Avery",
    );
    expect(screen.getAllByTestId("coming-up-day").length).toBeGreaterThan(0);
  });
});

describe("NextUpRegion calm flag", () => {
  const event: TodayEvent = {
    id: "e",
    title: "Dentist",
    start: at(5, 15),
    end: at(5, 16),
    isTask: false,
    source: null,
    addedById: "a",
    happeningNow: false,
    startedEarlier: false,
  };
  const people = new Map([
    ["a", { name: "Avery", color: "purple" as const }],
  ]);
  const show = (calm: boolean) =>
    render(
      <I18nProvider locale="en">
        <NextUpRegion
          calm={calm}
          events={[event]}
          people={people}
          chores={[]}
          showChores
          calendarHref="/dashboard/calendar"
          choresHref="/dashboard/chores"
        />
      </I18nProvider>,
    );

  it('keeps "Added by" unless the calm page asks to drop it', () => {
    const plain = show(false);
    expect(screen.getByTestId("event-member")).toHaveTextContent(
      "Added by Avery",
    );
    expect(screen.queryByTestId("today-next")).toBeNull();
    plain.unmount();
    show(true);
    expect(screen.queryByTestId("event-member")).toBeNull();
    expect(screen.getByTestId("today-next")).toBeInTheDocument();
  });
});

describe("RegionLine", () => {
  it("is plain words, not a link, when there is nowhere to go", () => {
    render(
      <RegionLine
        id="x"
        area="dinner"
        title="Dinner tonight"
        icon={UtensilsCrossed}
        glyph="meals"
        href={null}
        value="Tacos"
      />,
    );
    const line = screen.getByRole("region", { name: "Dinner tonight" });
    expect(line).toHaveTextContent("Tacos");
    expect(within(line).queryByRole("link")).toBeNull();
  });
});

describe("comingUpSummary", () => {
  const days = (events: TodayBoardData["events"], dinners = data().dinners) =>
    comingUp(events, dinners, NOW, 3, "en-US");

  it("names the next event, its day and how many more follow", () => {
    const summary = comingUpSummary(days(data().events), true)!;
    expect(summary).toMatchObject({
      kind: "event",
      title: "Library returns",
      tomorrow: true,
      more: 2,
    });
  });

  it("skips empty days and says which day the next event is on", () => {
    const summary = comingUpSummary(
      days(data().events.filter((event) => event.id !== "e3")),
      true,
    )!;
    expect(summary).toMatchObject({ title: "Swim lesson", tomorrow: false, more: 1 });
    expect(summary.day.label).toBe("Wednesday");
  });

  it("is null when nothing is coming, and ignores dinners when meals are off", () => {
    const dinners = [
      { id: "d", day: "2026-01-06", recipeName: "Soup", cookName: null },
    ];
    expect(comingUpSummary(days([], []), true)).toBeNull();
    expect(comingUpSummary(days([], dinners), false)).toBeNull();
    expect(comingUpSummary(days([], dinners), true)).toMatchObject({
      kind: "dinner",
      title: "Soup",
      more: 0,
    });
  });
});
