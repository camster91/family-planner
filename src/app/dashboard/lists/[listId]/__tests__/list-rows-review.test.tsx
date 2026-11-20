/**
 * @jest-environment jsdom
 */
// Lists UI review fixes: tick first and a tappable row, one "More for <item>"
// menu per row, the add field above the sections, done to-dos below open
// ones, no lone "Other" header and several items added at once.
import "@testing-library/jest-dom";
import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ListDetailClient from "../ListDetailClient";
import { ToastProvider } from "@/components/ui/toast";
import { splitListItems } from "../split-items";

const mockSetChecked = jest.fn(async () => {});
jest.mock("../use-list-item-sync", () => ({
  __emptyOperations: Object.freeze([]),
  useListItemSync: () => ({
    operations: require("../use-list-item-sync").__emptyOperations,
    online: true,
    durable: true,
    pendingCount: 0,
    notice: null,
    dismissNotice: () => {},
    stateFor: () => undefined,
    setChecked: (...args: unknown[]) => mockSetChecked(...(args as [])),
    retry: async () => {},
    discard: async () => {},
  }),
}));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn() }),
}));

const base = { quantity: 1, category: null, added_by: { name: "Pat" } };
const LONG =
  "Sourdough sandwich loaf from the bakery counter, sliced thin for the week";
const TODOS = [
  { ...base, id: "a", content: "Pack lunches", checked: true },
  { ...base, id: "b", content: "Water plants", checked: false },
  { ...base, id: "c", content: "Sign forms", checked: true },
  { ...base, id: "d", content: LONG, checked: false },
];

type Call = { url: string; body: any; headers: Record<string, string> };
let calls: Call[] = [];
let reply: (call: Call, index: number) => Response | Promise<Response>;

beforeEach(() => {
  calls = [];
  mockSetChecked.mockClear();
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    get: () => true,
  });
  reply = (call, index) =>
    ({
      ok: true,
      status: 200,
      json: async () => ({
        item: {
          id: `new-${index}`,
          content: call.body.content,
          quantity: call.body.quantity ?? 1,
          checked: false,
        },
      }),
    }) as Response;
  global.fetch = jest.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      // Only item creates are recorded; other page reads get an empty reply.
      if (String(input) !== "/api/lists/items/create")
        return { ok: false, status: 404, json: async () => ({}) } as Response;
      const call = {
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null,
        headers: (init?.headers ?? {}) as Record<string, string>,
      };
      calls.push(call);
      return reply(call, calls.length);
    },
  ) as unknown as typeof fetch;
});

function renderList(
  props: Partial<React.ComponentProps<typeof ListDetailClient>> = {},
) {
  return render(
    <ToastProvider>
      <ListDetailClient
        listId="l1"
        listName="Weekend"
        listType="todo"
        userId="u1"
        items={TODOS}
        {...props}
      />
    </ToastProvider>,
  );
}

const rowNames = () =>
  screen
    .getAllByRole("checkbox")
    .map((row) => row.textContent?.replace(/✓.*$/, "").trim());

describe("rows", () => {
  it("puts the tick circle first and ticks when the name is tapped", async () => {
    renderList();
    const row = screen.getByRole("checkbox", { name: /Water plants/ });
    expect(row.firstElementChild).toHaveAttribute(
      "data-testid",
      "list-item-tick",
    );
    await userEvent.click(screen.getByText("Water plants"));
    expect(mockSetChecked).toHaveBeenCalledWith("b", true);
  });

  it("lets a long name use the full row and wrap at word boundaries", () => {
    renderList({ canDeleteItems: false, canEditItems: false });
    const name = screen.getByText(LONG);
    expect(name.className).toContain("[overflow-wrap:break-word]");
    expect(name.className).toContain("[word-break:normal]");
    expect(name.className).not.toMatch(/truncate|break-all|anywhere/);
    // No action buttons share the row with the name.
    const row = name.closest('[role="checkbox"]')!;
    expect(row.className).toContain("flex-1");
    expect(row.parentElement!.querySelectorAll("button")).toHaveLength(1);
  });

  it('groups a parent\'s actions behind one 44px "More for <item>" button; Escape closes and returns focus', async () => {
    const user = userEvent.setup();
    renderList();
    expect(screen.queryByRole("button", { name: /^Delete / })).toBeNull();
    const more = screen.getByRole("button", { name: "More for Water plants" });
    expect(more).toHaveClass("min-h-[44px]", "min-w-[44px]");
    await user.click(more);
    const actions = screen.getByRole("group", {
      name: "Actions for Water plants",
    });
    expect(more).toHaveAttribute("aria-controls", actions.id);
    expect(
      screen.getByRole("button", { name: "Delete Water plants" }),
    ).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("group", { name: "Actions for Water plants" }),
    ).toBeNull();
    expect(more).toHaveFocus();
  });

  it("gives a child's rows only the tick", () => {
    renderList({ canDeleteItems: false, canEditItems: false });
    expect(screen.queryByRole("button", { name: /^More for / })).toBeNull();
    expect(screen.queryByTestId("list-item-more")).toBeNull();
    expect(screen.getAllByRole("checkbox")).toHaveLength(4);
  });
});

describe("to-do order and headers", () => {
  it("shows done items below open ones and no lone OTHER header", () => {
    renderList();
    expect(rowNames()).toEqual([
      "Water plants",
      LONG,
      "Pack lunches",
      "Sign forms",
    ]);
    expect(screen.queryByText("Other")).toBeNull();
  });

  it("keeps headers when there are several categories", () => {
    renderList({
      items: [
        { ...TODOS[0], category: "School" },
        { ...TODOS[1], category: "Home" },
      ],
    });
    expect(screen.getByText("School")).toBeInTheDocument();
    expect(screen.getByText("Home")).toBeInTheDocument();
  });

  it("puts the add field above the sections", () => {
    renderList();
    const field = screen.getByRole("textbox", { name: "Add an item" });
    const firstRow = screen.getAllByTestId("list-item")[0];
    expect(
      field.compareDocumentPosition(firstRow) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("several items at once", () => {
  it("previews, then creates each item in order with its quantity and an idempotency key", async () => {
    const user = userEvent.setup();
    renderList({ items: [] });
    const field = screen.getByRole("textbox", { name: "Add an item" });
    await user.type(field, "milk, eggs and 2 bread");
    const preview = screen.getByTestId("list-add-preview");
    expect(preview).toHaveTextContent(
      "Will add 3 items: milk · eggs · 2 bread",
    );
    expect(field.getAttribute("aria-describedby")).toContain(preview.id);
    await user.keyboard("{Enter}");
    await screen.findByText("Added 3 items");
    expect(calls.map((c) => c.body)).toEqual([
      { listId: "l1", content: "milk" },
      { listId: "l1", content: "eggs" },
      { listId: "l1", content: "bread", quantity: 2 },
    ]);
    const keys = calls.map((c) => c.headers["Idempotency-Key"]);
    expect(new Set(keys).size).toBe(3);
    expect(keys.every(Boolean)).toBe(true);
    // The quantity shows as the row's detail line.
    expect(rowNames()).toEqual(["milk", "eggs", "bread× 2"]);
    expect((field as HTMLTextAreaElement).value).toBe("");
  });

  it("stops at a failure, keeps the rest in the field and reuses the failed item's key on retry", async () => {
    const user = userEvent.setup();
    renderList({ items: [] });
    reply = (call, index) =>
      index === 2
        ? ({
            ok: false,
            status: 500,
            json: async () => ({}),
          } as Response)
        : ({
            ok: true,
            status: 200,
            json: async () => ({
              item: {
                id: `n${index}`,
                content: call.body.content,
                checked: false,
              },
            }),
          } as Response);
    const field = screen.getByRole("textbox", {
      name: "Add an item",
    }) as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: "milk\neggs\n2 bread" } });
    fireEvent.keyDown(field, { key: "Enter" });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Added 1 of 3 items.");
    expect(field.value).toBe("eggs\n2 bread");
    expect(rowNames()).toEqual(["milk"]);
    const failedKey = calls[1].headers["Idempotency-Key"];
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(field.value).toBe(""));
    expect(calls[2].body).toEqual({ listId: "l1", content: "eggs" });
    expect(calls[2].headers["Idempotency-Key"]).toBe(failedKey);
    expect(calls[3].body).toEqual({
      listId: "l1",
      content: "bread",
      quantity: 2,
    });
  });

  it("sends a single item exactly as before (no key, no quantity, no preview)", async () => {
    const user = userEvent.setup();
    renderList({ items: [] });
    await user.type(
      screen.getByRole("textbox", { name: "Add an item" }),
      "2 bread{Enter}",
    );
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(screen.queryByTestId("list-add-preview")).toBeNull();
    expect(calls[0].body).toEqual({ listId: "l1", content: "2 bread" });
    expect(calls[0].headers["Idempotency-Key"]).toBeUndefined();
  });
});

describe("splitListItems", () => {
  it("splits on commas, new lines and 'and', reading a leading number as the quantity", () => {
    expect(splitListItems("milk, eggs and 2 bread")).toEqual([
      { content: "milk", quantity: 1 },
      { content: "eggs", quantity: 1 },
      { content: "bread", quantity: 2 },
    ]);
    expect(splitListItems("apples\n3x lemons\r\n\n 12 eggs ")).toEqual([
      { content: "apples", quantity: 1 },
      { content: "lemons", quantity: 3 },
      { content: "eggs", quantity: 12 },
    ]);
    expect(splitListItems("leche y 2 huevos", "es")).toEqual([
      { content: "leche", quantity: 1 },
      { content: "huevos", quantity: 2 },
    ]);
  });

  it("returns null for one item so it is added as typed", () => {
    expect(splitListItems("2 bread")).toBeNull();
    expect(splitListItems("Sandy beach towels")).toBeNull();
    expect(splitListItems("milk,")).toBeNull();
    expect(splitListItems("0 apples, pears")).toEqual([
      { content: "0 apples", quantity: 1 },
      { content: "pears", quantity: 1 },
    ]);
  });
});
