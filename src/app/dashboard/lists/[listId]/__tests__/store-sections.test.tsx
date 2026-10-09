/**
 * @jest-environment jsdom
 */
import * as React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import ListDetailClient, { type SectionSortProps } from "../ListDetailClient";
import { GROCERY_SECTIONS } from "@/lib/grocery-sections";
import { ToastProvider } from "@/components/ui/toast";
import { I18nProvider, useTranslation } from "@/i18n";

// Store sections (#273). The offline queue (#162) is covered by its own tests;
// here the queue mock only lets a tick be shown as queued.
const mockQueued = new Map<string, boolean>();
jest.mock("../use-list-item-sync", () => ({
  __emptyOperations: Object.freeze([]),
  useListItemSync: () => ({
    operations: require("../use-list-item-sync").__emptyOperations,
    online: true,
    durable: true,
    pendingCount: 0,
    notice: null,
    dismissNotice: () => {},
    stateFor: (id: string) =>
      mockQueued.has(id)
        ? {
            id: `op-${id}`,
            state: "pending",
            payload: { itemId: id, checked: mockQueued.get(id) },
          }
        : undefined,
    setChecked: async () => {},
    retry: async () => {},
    discard: async () => {},
  }),
}));

const base = { quantity: 1, category: null, added_by: { name: "Pat" } };
const sort = (over: Partial<SectionSortProps> = {}): SectionSortProps => ({
  enabled: true,
  order: [...GROCERY_SECTIONS],
  learned: false,
  overrides: {},
  canChange: true,
  ...over,
});

const ITEMS = [
  {
    ...base,
    id: "soap",
    content: "Dish soap",
    checked: false,
    section: "household",
  },
  {
    ...base,
    id: "tom1",
    content: "Tomatoes",
    checked: false,
    amount: 6,
    ingredient_id: "ing_tom",
    ingredient_name: "Tomatoes",
    recipe_title: "Veggie lasagna",
    section: "produce",
  },
  {
    ...base,
    id: "milk",
    content: "Milk",
    checked: false,
    quantity: 2,
    section: "dairy_eggs",
  },
  {
    ...base,
    id: "tom2",
    content: "Tomatoes",
    checked: false,
    amount: 8,
    unit: "pcs",
    ingredient_id: "ing_tom",
    ingredient_name: "Tomatoes",
    recipe_title: "Tomato soup",
    section: "produce",
  },
  {
    ...base,
    id: "bread",
    content: "Bread",
    checked: true,
    checked_by: { name: "Sam" },
    section: "bakery",
  },
  // Added on this page before a refresh: no server section, resolved on the client.
  { ...base, id: "peas", content: "Frozen peas", checked: false },
];

function LocaleToggle() {
  const { setLocale } = useTranslation();
  return <button onClick={() => setLocale("es")}>Change locale</button>;
}
function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <I18nProvider>
        <LocaleToggle />
        {children}
      </I18nProvider>
    </ToastProvider>
  );
}
function renderList(
  props: Partial<React.ComponentProps<typeof ListDetailClient>> = {},
) {
  return render(
    <ListDetailClient
      listId="l1"
      listName="Groceries"
      listType="grocery"
      userId="u1"
      items={ITEMS}
      sectionSort={sort()}
      {...props}
    />,
    { wrapper: Providers },
  );
}

const sectionNames = () =>
  screen
    .getAllByTestId("store-section")
    .map((s) => s.getAttribute("aria-label"));
const order = () =>
  screen
    .getAllByTestId("list-item")
    .map((el) => el.getAttribute("data-item-id"));

describe("grocery list grouped by store section (#273)", () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    mockQueued.clear();
  });
  afterEach(() => {
    global.fetch = realFetch;
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: true,
    });
  });

  it("shows text section headers in the fixed store order, only for sections with rows", () => {
    renderList();
    expect(sectionNames()).toEqual([
      "Produce",
      "Bakery",
      "Dairy & eggs",
      "Frozen",
      "Household",
    ]);
    for (const name of [
      "Produce",
      "Bakery",
      "Dairy & eggs",
      "Frozen",
      "Household",
    ]) {
      expect(
        within(screen.getByRole("region", { name })).getByText(name),
      ).toBeTruthy();
    }
    expect(order()).toEqual(["tom1", "tom2", "bread", "milk", "peas", "soap"]);
  });

  it("keeps ingredient grouping and provenance inside a section, and checked rows as they are", () => {
    renderList();
    const produce = screen.getByRole("region", { name: "Produce" });
    const group = within(produce).getByRole("group", {
      name: "Tomatoes, 2 entries",
    });
    expect(
      within(group)
        .getAllByRole("checkbox")
        .map((r) => r.textContent),
    ).toEqual([
      expect.stringContaining("6 · from Veggie lasagna"),
      expect.stringContaining("8 pcs · from Tomato soup"),
    ]);
    const bread = screen.getByRole("checkbox", { name: /Bread/ });
    expect(bread.getAttribute("aria-checked")).toBe("true");
    expect(bread.textContent).toContain("✓ Sam");
    // Ticked rows have no "Move" action; open rows do.
    expect(
      screen.queryByRole("button", { name: "Move Bread to another section" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Move Milk to another section" }),
    ).toBeTruthy();
  });

  it("follows a learned walking order and says so", () => {
    renderList({
      sectionSort: sort({
        learned: true,
        order: [
          "household",
          "dairy_eggs",
          "produce",
          "bakery",
          "meat_fish",
          "frozen",
          "pantry",
          "snacks_drinks",
          "personal_care",
          "other",
        ],
      }),
    });
    expect(sectionNames()).toEqual([
      "Household",
      "Dairy & eggs",
      "Produce",
      "Bakery",
      "Frozen",
    ]);
    expect(
      screen.getByText(
        "Sections follow the order your household usually shops.",
      ),
    ).toBeTruthy();
  });

  it("a ticked row queued offline stays in its section (grouping needs no request)", () => {
    mockQueued.set("milk", true);
    global.fetch = jest.fn(() =>
      Promise.reject(new Error("offline")),
    ) as unknown as typeof fetch;
    renderList();
    const dairy = screen.getByRole("region", { name: "Dairy & eggs" });
    expect(
      within(dairy)
        .getByRole("checkbox", { name: /Milk/ })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      within(dairy).getByRole("checkbox", { name: /Milk/ }).textContent,
    ).toContain("Waiting to sync");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("Move to…: picks a section, sends PATCH /api/lists/items/section and regroups every matching row", async () => {
    const fetchMock = jest.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({
        nameKey: "tomatoes",
        override: "pantry",
        sections: { tom1: "pantry", tom2: "pantry" },
      }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;
    renderList();
    fireEvent.click(
      screen.getAllByRole("button", {
        name: "Move Tomatoes to another section",
      })[0],
    );
    const dialog = screen.getByRole("dialog", { name: "Move “Tomatoes”" });
    const options = within(dialog)
      .getAllByRole("button", { pressed: false })
      .concat(within(dialog).getAllByRole("button", { pressed: true }));
    expect(options).toHaveLength(GROCERY_SECTIONS.length);
    expect(
      within(dialog).getByRole("button", { name: /Produce/, pressed: true })
        .textContent,
    ).toContain("Current");
    expect(
      within(dialog).queryByRole("button", {
        name: "Use the automatic section",
      }),
    ).toBeNull();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Pantry" }));
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/lists/items/section",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]!.body))).toEqual({
      itemId: "tom1",
      section: "pantry",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(sectionNames()).toEqual([
      "Bakery",
      "Dairy & eggs",
      "Frozen",
      "Pantry",
      "Household",
    ]);
    expect(
      within(screen.getByRole("region", { name: "Pantry" })).getByRole(
        "group",
        { name: "Tomatoes, 2 entries" },
      ),
    ).toBeTruthy();

    // The household choice can be undone from the same sheet.
    fireEvent.click(
      screen.getAllByRole("button", {
        name: "Move Tomatoes to another section",
      })[0],
    );
    expect(
      screen.getByRole("button", { name: "Use the automatic section" }),
    ).toBeTruthy();
  });

  it("Move to…: explains a failure and an offline device, keeping the sheet open", async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    })) as unknown as typeof fetch;
    renderList();
    fireEvent.click(
      screen.getByRole("button", { name: "Move Milk to another section" }),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Household" }));
    });
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Couldn’t move this item. Try again.",
    );
    expect(screen.getByRole("dialog")).toBeTruthy();

    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: false,
    });
    (global.fetch as jest.Mock).mockClear();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Household" }));
    });
    expect(screen.getByRole("alert").textContent).toContain(
      "You’re offline. Moving an item needs a connection.",
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("the switch turns sorting off (category order, no Move) and back on, persisting per list", async () => {
    const fetchMock = jest.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({}),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;
    renderList();
    const toggle = screen.getByRole("switch", {
      name: /Sort by store section/,
    });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(toggle.textContent).toContain("On");
    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/lists/section-sort",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]!.body))).toEqual({
      listId: "l1",
      sortBySection: false,
    });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(toggle.textContent).toContain("Off");
    expect(screen.queryAllByTestId("store-section")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /^Move / })).toBeNull();
    // Category mode: rows in list order under "Other", ingredient group kept.
    expect(order()).toEqual(["soap", "tom1", "tom2", "milk", "bread", "peas"]);
    expect(
      screen.getByText("Items stay in the order they were added."),
    ).toBeTruthy();

    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]!.body))).toEqual({
      listId: "l1",
      sortBySection: true,
    });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(sectionNames()).toEqual([
      "Produce",
      "Bakery",
      "Dairy & eggs",
      "Frozen",
      "Household",
    ]);
  });

  it("reverts the switch and says so when saving fails", async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => ({}),
    })) as unknown as typeof fetch;
    renderList();
    const toggle = screen.getByRole("switch", {
      name: /Sort by store section/,
    });
    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("alert").textContent).toContain(
      "Couldn’t change the sorting.",
    );
  });

  it("a child sees the current setting as text, without a switch, and can still move items", () => {
    renderList({ sectionSort: sort({ canChange: false }) });
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.getByText("Sort by store section: On")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Move Milk to another section" }),
    ).toBeTruthy();
  });

  it("keeps an open current/chosen move target and exact automatic payload on locale change", async () => {
    const content = "Milk {section} 🥛";
    const fetchMock = jest.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({
        nameKey: "milk {section} 🥛",
        override: null,
        sections: { milk: "dairy_eggs" },
      }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;
    renderList({
      items: ITEMS.map((item) =>
        item.id === "milk" ? { ...item, content } : item,
      ),
      sectionSort: sort({ overrides: { "milk {section} 🥛": "dairy_eggs" } }),
    });
    const beforeOrder = order();
    fireEvent.click(
      screen.getByRole("button", {
        name: `Move ${content} to another section`,
      }),
    );
    const dialog = screen.getByRole("dialog", { name: `Move “${content}”` });
    expect(
      within(dialog).getByRole("button", {
        name: /Dairy & eggs/,
        pressed: true,
      }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Change locale" }));
    expect(screen.getByRole("dialog", { name: `Mover “${content}”` })).toBe(
      dialog,
    );
    expect(
      within(dialog).getByRole("button", {
        name: /Lácteos y huevos/,
        pressed: true,
      }).textContent,
    ).toContain("Actual");
    expect(order()).toEqual(beforeOrder);
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () =>
      fireEvent.click(
        within(dialog).getByRole("button", {
          name: "Usar la sección automática",
        }),
      ),
    );
    expect(fetchMock.mock.calls[0][0]).toBe("/api/lists/items/section");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]!.body))).toEqual({
      itemId: "milk",
      section: null,
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText(content)).toBeTruthy();
  });

  it("localizes sort headings and learned hints without changing order or writing on locale change", () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;
    renderList({ sectionSort: sort({ learned: true }) });
    const beforeOrder = order();
    fireEvent.click(screen.getByRole("button", { name: "Change locale" }));
    expect(
      screen
        .getByRole("switch", { name: "Ordenar por sección de la tienda" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      screen.getByText(
        "Las secciones siguen el orden en que suele comprar tu hogar.",
      ),
    ).toBeTruthy();
    expect(sectionNames()).toEqual([
      "Frutas y verduras",
      "Panadería",
      "Lácteos y huevos",
      "Congelados",
      "Artículos del hogar",
    ]);
    expect(order()).toEqual(beforeOrder);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the child sort state read-only and uses a complete localized state sentence", () => {
    renderList({ sectionSort: sort({ canChange: false, enabled: false }) });
    fireEvent.click(screen.getByRole("button", { name: "Change locale" }));
    expect(screen.queryByRole("switch")).toBeNull();
    expect(
      screen.getByText("Ordenar por sección de la tienda: desactivado"),
    ).toBeTruthy();
    expect(
      screen.getByText("Los artículos conservan el orden en que se añadieron."),
    ).toBeTruthy();
    expect(screen.queryByTestId("move-section")).toBeNull();
  });

  it("a list stored with sorting off opens in category order", () => {
    renderList({ sectionSort: sort({ enabled: false }) });
    expect(screen.queryAllByTestId("store-section")).toHaveLength(0);
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe(
      "false",
    );
  });

  it("generic lists have no sections, switch or Move action", () => {
    render(
      <ListDetailClient
        listId="l2"
        listName="Weekend"
        listType="todo"
        userId="u1"
        items={[{ ...base, id: "t", content: "Buy milk", checked: false }]}
        sectionSort={sort()}
      />,
      { wrapper: ToastProvider },
    );
    expect(screen.queryByTestId("section-sort")).toBeNull();
    expect(screen.queryAllByTestId("store-section")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /^Move / })).toBeNull();
  });
});

// Canonical refresh after a queued create; navigation is covered in browser tests.
jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn() }),
}));

// Submitted-create replay has its own real-queue component and browser suite.
jest.mock("../PersonGroceryAdd", () => ({ PersonGroceryAdd: () => null }));
