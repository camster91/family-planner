/**
 * @jest-environment jsdom
 */
// Route inventory F-6 (#289): /dashboard/lists/type/[type] redirects to the
// `?type=` filter of /dashboard/lists, and the type cards filter in place.
import * as React from "react";
import { render as rtlRender, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockRedirect = jest.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT ${url}`);
});
const mockReplace = jest.fn();
const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  redirect: (url: string) => mockRedirect(url),
  useRouter: () => ({
    replace: mockReplace,
    push: mockPush,
    refresh: jest.fn(),
  }),
}));

const mockPrisma = {
  user: { findUnique: jest.fn() },
  list: { findMany: jest.fn() },
};
jest.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
const mockServerUser = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  getServerUser: () => mockServerUser(),
}));

import ListsByTypePage from "../type/[type]/page";
import ListsPage from "../page";
import ListsClient from "../ListsClient";
import { I18nProvider, useTranslation } from "@/i18n";

function render(ui: React.ReactElement) {
  return rtlRender(<I18nProvider>{ui}</I18nProvider>);
}
function ChangeLanguage() {
  const { setLocale } = useTranslation();
  return <button onClick={() => setLocale("es")}>Change language</button>;
}
import { listTypeFilter, listsFilterHref } from "@/lib/list-type-filter";

const lists = [
  {
    id: "l1",
    name: "Weekly shop",
    type: "grocery",
    creator: { name: "Pat" },
    checked_count: 1,
    total_count: 3,
  },
  {
    id: "l2",
    name: "Chores to fix",
    type: "todo",
    creator: { name: "Pat" },
    checked_count: 0,
    total_count: 0,
  },
  {
    id: "l3",
    name: "Birthday ideas",
    type: "wishlist",
    creator: { name: "Sam" },
    checked_count: 0,
    total_count: 2,
  },
];

beforeEach(() => {
  jest.clearAllMocks();
});

describe("/dashboard/lists/type/[type] redirect", () => {
  it.each([
    ["grocery", "/dashboard/lists?type=grocery"],
    ["todo", "/dashboard/lists?type=todo"],
    ["meal_plan", "/dashboard/lists?type=meal_plan"],
    ["wishlist", "/dashboard/lists?type=wishlist"],
    ["shopping", "/dashboard/lists?type=shopping"],
    ["custom", "/dashboard/lists?type=custom"],
    ["nonsense", "/dashboard/lists"],
    ["grocery?x=1", "/dashboard/lists"],
  ])("%s → %s, without reading any household data", async (type, target) => {
    await expect(
      ListsByTypePage({ params: Promise.resolve({ type }) }),
    ).rejects.toThrow(`NEXT_REDIRECT ${target}`);
    expect(mockRedirect).toHaveBeenCalledWith(target);
    expect(mockPrisma.list.findMany).not.toHaveBeenCalled();
    expect(mockServerUser).not.toHaveBeenCalled();
  });
});

describe("list type filter helpers", () => {
  it("accepts only known types", () => {
    expect(listTypeFilter("todo")).toBe("todo");
    expect(listTypeFilter(["wishlist", "todo"])).toBe("wishlist");
    expect(listTypeFilter("__proto__")).toBeNull();
    expect(listTypeFilter(undefined)).toBeNull();
    expect(listsFilterHref(null)).toBe("/dashboard/lists");
  });
});

describe("/dashboard/lists ?type=", () => {
  it("passes a known type to the page and drops an unknown one", async () => {
    mockServerUser.mockResolvedValue({ id: "u1", role: "parent" });
    mockPrisma.user.findUnique.mockResolvedValue({
      family_id: "fam-a",
      family: { name: "Home" },
    });
    mockPrisma.list.findMany.mockResolvedValue([]);
    const known = await ListsPage({
      searchParams: Promise.resolve({ type: "todo" }),
    });
    const knownClient = React.Children.toArray(known?.props.children).find(
      (child) => React.isValidElement(child) && child.type === ListsClient,
    ) as React.ReactElement<{ initialType: unknown }>;
    expect(knownClient.props.initialType).toBe("todo");
    const unknown = await ListsPage({
      searchParams: Promise.resolve({ type: "bogus" }),
    });
    const unknownClient = React.Children.toArray(unknown?.props.children).find(
      (child) => React.isValidElement(child) && child.type === ListsClient,
    ) as React.ReactElement<{ initialType: unknown }>;
    expect(unknownClient.props.initialType).toBeNull();
    // The query stays household-scoped.
    expect(mockPrisma.list.findMany.mock.calls[0][0].where).toEqual({
      family_id: "fam-a",
    });
  });

  it('shows only the chosen type, says so, and "Show all lists" clears it', async () => {
    const user = userEvent.setup();
    render(<ListsClient lists={lists} familyName="Home" initialType="todo" />);
    expect(screen.getByRole("status").textContent).toBe(
      "Showing to-dos lists only",
    );
    expect(screen.getByText("Chores to fix")).toBeTruthy();
    expect(screen.queryByText("Weekly shop")).toBeNull();
    expect(
      screen.getByRole("button", { name: /To-dos/, pressed: true }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Add list" }).getAttribute("href"),
    ).toBe("/dashboard/lists/create?type=todo");

    const showAll = screen.getByRole("button", { name: "Show all lists" });
    expect(showAll.className).toContain("min-h-[44px]");
    await user.click(showAll);
    expect(mockReplace).toHaveBeenLastCalledWith("/dashboard/lists", {
      scroll: false,
    });
    expect(screen.getByText("Weekly shop")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("a type card filters in place (no navigation to the old page) and toggles off", async () => {
    const user = userEvent.setup();
    render(<ListsClient lists={lists} familyName="Home" />);
    const filters = within(
      screen.getByRole("region", { name: "Filter by type" }),
    );
    const wishlist = filters.getByRole("button", { name: /Wishlist/ });
    expect(wishlist.getAttribute("aria-pressed")).toBe("false");
    expect(wishlist.className).toContain("min-h-[44px]");

    await user.click(wishlist);
    expect(mockReplace).toHaveBeenLastCalledWith(
      "/dashboard/lists?type=wishlist",
      { scroll: false },
    );
    expect(mockPush).not.toHaveBeenCalled();
    expect(wishlist.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Birthday ideas")).toBeTruthy();
    expect(screen.queryByText("Weekly shop")).toBeNull();

    await user.click(wishlist);
    expect(mockReplace).toHaveBeenLastCalledWith("/dashboard/lists", {
      scroll: false,
    });
    expect(screen.getByText("Weekly shop")).toBeTruthy();
  });

  it("an empty filter explains itself; meal plan offers no new list (ADR-0007 O-8)", () => {
    const { unmount } = render(
      <ListsClient
        lists={lists}
        familyName="Home"
        initialType="shopping"
        canCreate
      />,
    );
    expect(
      screen.getByRole("heading", { name: "No shopping lists" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /Create List/ }).getAttribute("href"),
    ).toBe("/dashboard/lists/create?type=shopping");
    unmount();

    render(
      <ListsClient
        lists={lists}
        familyName="Home"
        initialType="meal_plan"
        canCreate
      />,
    );
    expect(screen.getByText("Meals are planned in Meals now.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Create List/ })).toBeNull();
  });

  it('"Add list" is the same filled primary "+" as Chores and Calendar', () => {
    render(<ListsClient lists={lists} familyName="Home" canCreate />);
    const add = screen.getByRole("link", { name: "Add list" });
    expect(add.className).toContain("btn-filled");
    expect(add.className).not.toContain("btn-tinted");
  });

  it("a child sees the filter but no create action", () => {
    render(
      <ListsClient
        lists={lists}
        familyName="Home"
        initialType="grocery"
        canCreate={false}
      />,
    );
    expect(screen.getByText("Weekly shop")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Add list" })).toBeNull();
  });
});

describe("localized list overview (#411)", () => {
  it("changes mounted filter copy without changing names, counts or navigation", async () => {
    const user = userEvent.setup();
    const originalName = "Family {count} 🏡";
    const householdLists = [
      { ...lists[0], name: "Pan {count} 🥖", creator: { name: "Pat 🥛" } },
      {
        ...lists[0],
        id: "l4",
        name: "Second shop",
        creator: { name: "Pat 🥛" },
        checked_count: 2,
        total_count: 5,
      },
    ];
    render(
      <>
        <ChangeLanguage />
        <ListsClient
          lists={householdLists}
          familyName={originalName}
          initialType="grocery"
        />
      </>,
    );
    expect(screen.getByRole("status").textContent).toBe(
      "Showing grocery lists only",
    );
    expect(
      screen.getByRole("button", { name: "Groceries 2 lists", pressed: true }),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("heading", { name: "Alimentos" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe(
      "Solo se muestran listas de alimentos",
    );
    expect(
      screen.getByRole("button", { name: "Alimentos 2 listas", pressed: true }),
    ).toBeTruthy();
    expect(screen.getByText(originalName)).toBeTruthy();
    expect(screen.getByText("Pan {count} 🥖")).toBeTruthy();
    expect(screen.getByText("1/3")).toBeTruthy();
    expect(screen.getByText("2/5")).toBeTruthy();
    expect(screen.getAllByText("Pat 🥛")).toHaveLength(2);
    expect(
      screen.getByRole("link", { name: "Añadir lista" }).getAttribute("href"),
    ).toBe("/dashboard/lists/create?type=grocery");
    expect(mockReplace).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: "Mostrar todas las listas" }),
    );
    expect(mockReplace).toHaveBeenLastCalledWith("/dashboard/lists", {
      scroll: false,
    });
    await user.click(screen.getByRole("button", { name: "Tareas" }));
    expect(mockReplace).toHaveBeenLastCalledWith("/dashboard/lists?type=todo", {
      scroll: false,
    });
    expect(
      screen.getByRole("heading", { name: "No hay listas de tareas" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Crear lista" }).getAttribute("href"),
    ).toBe("/dashboard/lists/create?type=todo");
  });

  it("uses singular counts and keeps legacy meal plans readable without a create action", async () => {
    const user = userEvent.setup();
    render(
      <>
        <ChangeLanguage />
        <ListsClient
          lists={[
            ...lists,
            {
              ...lists[0],
              id: "legacy",
              name: "Legacy family menu",
              type: "meal_plan",
            },
          ]}
          familyName="Home"
          initialType="meal_plan"
        />
      </>,
    );
    expect(
      screen.getByRole("button", { name: "Meal plan 1 list", pressed: true }),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Change language" }));
    expect(
      screen.getByRole("button", {
        name: "Plan de comidas 1 lista",
        pressed: true,
      }),
    ).toBeTruthy();
    expect(screen.getByText("Legacy family menu")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Crear lista" })).toBeNull();
    expect(
      screen.getByRole("link", { name: "Añadir lista" }).getAttribute("href"),
    ).toBe("/dashboard/lists/create");
  });

  it("localizes empty child and retired meal-plan states while retaining creation restrictions", () => {
    const { unmount } = rtlRender(
      <I18nProvider locale="es">
        <ListsClient lists={[]} familyName="Casa" canCreate={false} />
      </I18nProvider>,
    );
    expect(
      screen.getByRole("heading", { name: "Aún no hay listas" }),
    ).toBeTruthy();
    expect(
      screen.getByText("Pide a un padre o madre que cree una lista nueva."),
    ).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Añadir lista" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Crear lista" })).toBeNull();
    unmount();
    rtlRender(
      <I18nProvider locale="es">
        <ListsClient lists={[]} familyName="Casa" initialType="meal_plan" />
      </I18nProvider>,
    );
    expect(
      screen.getByRole("heading", {
        name: "No hay listas de planes de comidas",
      }),
    ).toBeTruthy();
    expect(
      screen.getByText("Ahora las comidas se planifican en Comidas."),
    ).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Crear lista" })).toBeNull();
  });
});


it('filters custom lists without renaming household content', async () => {
  render(<ListsClient lists={[...lists, { id: 'custom1', name: 'Camping packing', type: 'custom', creator: { name: 'Pat' }, checked_count: 1, total_count: 5 }]} familyName="Our Family" initialType="custom" />)
  expect(screen.getByText('Custom Lists')).toBeTruthy()
  expect(screen.getByText('Camping packing')).toBeTruthy()
  expect(screen.queryByText('Weekly shop')).toBeNull()
  expect(screen.getByRole('link', { name: 'Add list' }).getAttribute('href')).toBe('/dashboard/lists/create?type=custom')
})
