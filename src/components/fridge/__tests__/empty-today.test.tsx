/**
 * @jest-environment jsdom
 */
// Honest empty states on the personal Today page (owner-approved review A3/A4):
// an empty card is one line that says what is missing and the one thing to do
// first. A household that never added a chore is not told "No chores due
// today", and one without a grocery list is not told its list "is clear".
import "@testing-library/jest-dom";
import * as React from "react";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TodayBoard from "../TodayBoard";
import { ToastProvider } from "@/components/ui/toast";
import type { TodayBoardData } from "@/app/dashboard/today/today-board-data";
import type { TodayStarts } from "@/app/dashboard/today/get-started-data";
import { I18nProvider } from "@/i18n";

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

const NOW = new Date(2026, 0, 5, 12, 0, 0);

function emptyData(overrides: Partial<TodayBoardData> = {}): TodayBoardData {
  return {
    generatedAt: NOW.toISOString(),
    version: "v1",
    members: [{ id: "p", name: "Avery Parent", color: "purple" }],
    events: [],
    chores: [],
    dinners: [],
    shopping: { items: [], total: 0 },
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

async function renderToday({
  data = emptyData(),
  starts,
  role = "parent",
  fridgeMode = false,
}: {
  data?: TodayBoardData;
  starts?: TodayStarts;
  role?: string;
  fridgeMode?: boolean;
} = {}) {
  const utils = render(
    <I18nProvider locale="en">
      <ToastProvider>
        <TodayBoard
          data={data}
          fridgeMode={fridgeMode}
          viewer={{ id: "p", role }}
          starts={starts}
          checkVersion={async () => "v1"}
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

const NEW_FAMILY: TodayStarts = { hasChore: false, hasGroceryList: true };

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  refresh.mockReset();
});
afterEach(() => jest.useRealTimers());

describe("personal Today, a brand-new household", () => {
  it("shrinks each empty card to one line with its first action", async () => {
    await renderToday({ starts: NEW_FAMILY });
    for (const area of ["today", "chores", "dinner", "groceries", "coming"]) {
      const region = screen.getByTestId(`region-${area}`);
      expect(region).toHaveAttribute("data-empty-line");
      // One line: a heading and its message, no list of rows.
      expect(within(region).queryByRole("list")).toBeNull();
    }
    const today = screen.getByTestId("region-today");
    expect(today).toHaveTextContent("Nothing on the calendar today.");
    expect(within(today).getByRole("link", { name: "Add event" })).toHaveAttribute(
      "href",
      "/dashboard/calendar/create",
    );
    const dinner = screen.getByTestId("region-dinner");
    expect(dinner).toHaveTextContent("No dinner planned yet.");
    expect(within(dinner).getByRole("link", { name: "Plan dinner" })).toBeTruthy();
    const coming = screen.getByTestId("region-coming");
    expect(coming).toHaveTextContent("Nothing on the calendar for the next few days.");
    expect(within(coming).getByRole("link", { name: "Connect a calendar" })).toHaveAttribute(
      "href",
      "/dashboard/settings#calendar-subscriptions",
    );
  });

  it('says "No chores yet" with Add a chore, never a falsely calm "All clear"', async () => {
    await renderToday({ starts: NEW_FAMILY });
    const chores = screen.getByTestId("region-chores");
    expect(chores).toHaveTextContent("No chores yet.");
    expect(chores).not.toHaveTextContent(/All clear|No chores due today/);
    expect(within(chores).getByRole("link", { name: "Add a chore" })).toHaveAttribute(
      "href",
      "/dashboard/chores/create",
    );
  });

  it("an empty grocery list asks for groceries instead of calling the list clear", async () => {
    await renderToday({ starts: NEW_FAMILY });
    const groceries = screen.getByTestId("region-groceries");
    expect(groceries).toHaveTextContent("Nothing on the grocery list yet.");
    expect(groceries).not.toHaveTextContent("The grocery list is clear.");
    expect(within(groceries).getByRole("link", { name: "Add groceries" })).toHaveAttribute(
      "href",
      "/dashboard/lists/groceries",
    );
  });

  it("keeps the plain wording when chores exist but none are due today", async () => {
    await renderToday({ starts: { hasChore: true, hasGroceryList: true } });
    const chores = screen.getByTestId("region-chores");
    expect(chores).toHaveTextContent("No chores due today.");
    expect(within(chores).queryByRole("link", { name: "Add a chore" })).toBeNull();
  });

  it("does not offer Add a chore to a child", async () => {
    await renderToday({ starts: NEW_FAMILY, role: "child" });
    expect(within(screen.getByTestId("region-chores")).queryByRole("link")).toBeNull();
    // Children cannot open the calendar editor or settings either.
    expect(within(screen.getByTestId("region-today")).queryByRole("link")).toBeNull();
    expect(within(screen.getByTestId("region-coming")).queryByRole("link")).toBeNull();
  });
});

describe("a household without any grocery list (older households)", () => {
  it("offers Create a grocery list, which uses the find-or-create route once and refreshes", async () => {
    jest.useRealTimers();
    const fetchMock = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }) as Response);
    global.fetch = fetchMock as unknown as typeof fetch;
    const user = userEvent.setup();
    await renderToday({ starts: { hasChore: true, hasGroceryList: false } });
    const groceries = screen.getByTestId("region-groceries");
    expect(groceries).toHaveTextContent("No grocery list yet.");
    expect(groceries).not.toHaveTextContent(/is clear/);
    await user.click(within(groceries).getByRole("button", { name: "Create a grocery list" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/lists/default-grocery", { method: "POST" });
    expect(refresh).toHaveBeenCalled();
  });

  it("says why when the list could not be made, and lets them try again", async () => {
    jest.useRealTimers();
    global.fetch = jest.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }) as Response) as unknown as typeof fetch;
    const user = userEvent.setup();
    await renderToday({ starts: { hasChore: true, hasGroceryList: false } });
    await user.click(screen.getByRole("button", { name: "Create a grocery list" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not create the list. Try again.");
    expect(screen.getByRole("button", { name: "Create a grocery list" })).toBeEnabled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("a child sees the honest line but no create button (lists are parent and teen)", async () => {
    await renderToday({ starts: { hasChore: true, hasGroceryList: false }, role: "child" });
    const groceries = screen.getByTestId("region-groceries");
    expect(groceries).toHaveTextContent("No grocery list yet.");
    expect(within(groceries).queryByRole("button")).toBeNull();
  });

  it("the paired tablet board says there is no grocery list instead of calling it clear", async () => {
    await renderToday({ data: emptyData({ groceryLists: [] }), fridgeMode: true });
    const groceries = screen.getByTestId("region-groceries");
    expect(groceries).not.toHaveAttribute("data-empty-line");
    expect(groceries).toHaveTextContent("No grocery list yet.");
  });

  it("the fridge board keeps the plain wording when a grocery list exists", async () => {
    await renderToday({ data: emptyData({ groceryLists: [{ id: "l1", name: "Groceries" }] }), fridgeMode: true });
    expect(screen.getByTestId("region-groceries")).toHaveTextContent("The grocery list is clear.");
  });
});
