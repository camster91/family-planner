/** @jest-environment jsdom */
import * as React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  createOfflineQueue,
  QUEUE_MAX_AGE_MS,
  type OfflineQueue,
  type QueueStore,
  type SendFn,
} from "@/lib/offline-queue";
import { PersonGroceryAdd } from "../PersonGroceryAdd";
import ListDetailClient from "../ListDetailClient";
import { ToastProvider } from "@/components/ui/toast";

let mockQueue: OfflineQueue;
const mockRefresh = jest.fn();
jest.mock("@/lib/offline-queue-browser", () => ({
  getPersonQueue: () => mockQueue,
}));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

let online: boolean, now: number;
let raw: string | null;
let store: QueueStore;
let send: jest.MockedFunction<SendFn>;
let keySeq = 0;
const props = { listId: "list-a", userId: "parent-a" };
const buildQueue = () =>
  createOfflineQueue({
    store,
    send,
    now: () => now,
    random: () => 0.5,
    newKey: () => `test-operation-${++keySeq}`,
    isOnline: () => online,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  });
beforeEach(() => {
  online = false;
  now = Date.now();
  raw = null;
  keySeq = 0;
  mockRefresh.mockReset();
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    get: () => online,
  });
  store = {
    read: async () => raw,
    write: async (value) => {
      raw = value;
    },
    remove: async () => {
      raw = null;
    },
  };
  send = jest.fn<ReturnType<SendFn>, Parameters<SendFn>>(async () => ({
    status: 200,
    body: {
      success: true,
      item: { id: "server-item", content: "Old replay text" },
    },
  }));
  mockQueue = buildQueue();
});
afterEach(() => mockQueue.dispose());
async function typeAndSubmit(text = "Milk") {
  const user = userEvent.setup();
  await user.type(screen.getByRole("textbox", { name: "Add an item" }), text);
  await user.click(screen.getByRole("button", { name: /^Add$/ }));
}
async function reconnect() {
  online = true;
  await act(async () => {
    window.dispatchEvent(new Event("online"));
    await mockQueue.handleOnline();
  });
}

it("queues a submitted offline add with visible state, then refreshes canonical rows on confirmation", async () => {
  render(<PersonGroceryAdd {...props} />);
  await typeAndSubmit();
  expect(send).not.toHaveBeenCalled();
  expect(
    screen.getByTestId("queued-grocery-add").getAttribute("data-sync-state"),
  ).toBe("pending");
  expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("");
  expect(JSON.parse(raw!).ops[0].payload).toEqual({
    listId: "list-a",
    content: "Milk",
  });
  expect(screen.getByRole("status").textContent).not.toMatch(
    /confirmed|added to/i,
  );
  await reconnect();
  expect(send.mock.calls[0][0]).toMatchObject({
    method: "POST",
    path: "/api/lists/items/grocery-add",
    body: { listId: "list-a", content: "Milk" },
  });
  expect(mockRefresh).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId("queued-grocery-add")).toBeNull();
  expect(screen.getByRole("status").textContent).toContain("confirmed");
  expect(screen.queryByText("Old replay text")).toBeNull();
});
it("keeps submitted text, original key/body and status through unmount/restart and an uncertain send", async () => {
  const first = render(<PersonGroceryAdd {...props} />);
  await typeAndSubmit();
  const key = mockQueue.list()[0].id;
  first.unmount();
  mockQueue.dispose();
  mockQueue = buildQueue();
  render(<PersonGroceryAdd {...props} />);
  await screen.findByTestId("queued-grocery-add");
  send.mockRejectedValueOnce(new TypeError("network lost"));
  await reconnect();
  expect(
    screen.getByTestId("queued-grocery-add").getAttribute("data-sync-state"),
  ).toBe("pending");
  await userEvent.click(screen.getByRole("button", { name: "Try now" }));
  await waitFor(() =>
    expect(screen.queryByTestId("queued-grocery-add")).toBeNull(),
  );
  expect(send.mock.calls.map(([request]) => request.idempotencyKey)).toEqual([
    key,
    key,
  ]);
  expect(send.mock.calls[0][0].body).toEqual(send.mock.calls[1][0].body);
});
it("leaves a definitive failure recoverable with an explicit same-key retry", async () => {
  online = true;
  send.mockResolvedValueOnce({ status: 403, body: { error: "Forbidden" } });
  render(<PersonGroceryAdd {...props} />);
  await typeAndSubmit();
  await waitFor(() =>
    expect(
      screen.getByTestId("queued-grocery-add").getAttribute("data-sync-state"),
    ).toBe("failed"),
  );
  await userEvent.click(screen.getByRole("button", { name: "Retry add" }));
  await waitFor(() =>
    expect(screen.queryByTestId("queued-grocery-add")).toBeNull(),
  );
  expect(send.mock.calls[0][0].idempotencyKey).toBe(
    send.mock.calls[1][0].idempotencyKey,
  );
});
it("restores missing-list conflict recovery without offering new creation or deleting a server row", async () => {
  await mockQueue.enqueue("list-item.grocery-add", {
    listId: "list-a",
    content: "Lost-list milk",
  });
  render(<PersonGroceryAdd {...props} allowNew={false} />);
  await screen.findByTestId("queued-grocery-add");
  send.mockResolvedValue({ status: 404, body: { error: "List not found" } });
  await reconnect();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(
    screen.getByTestId("queued-grocery-add").getAttribute("data-sync-state"),
  ).toBe("conflict");
  await userEvent.click(
    screen.getByRole("button", { name: "Remove queued add" }),
  );
  expect(mockQueue.list()).toEqual([]);
  expect(send).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("status").textContent).toContain(
    "previous send may have added it",
  );
});
it("offers no retry/discard while a send is in flight and never claims early confirmation", async () => {
  online = true;
  let resolve!: (value: { status: number; body: unknown }) => void;
  send.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  render(<PersonGroceryAdd {...props} />);
  await typeAndSubmit();
  expect(
    screen.getByTestId("queued-grocery-add").getAttribute("data-sync-state"),
  ).toBe("syncing");
  expect(
    screen.queryByRole("button", { name: "Remove queued add" }),
  ).toBeNull();
  expect(screen.getByRole("status").textContent).not.toContain("confirmed");
  await act(async () => {
    resolve({ status: 200, body: {} });
    await mockQueue.drain();
  });
  expect(mockRefresh).toHaveBeenCalled();
});
it("keeps an unsubmitted draft out of storage and retains text when the queue is full", async () => {
  for (let i = 0; i < 50; i++)
    await mockQueue.enqueue("list-item.set-checked", {
      itemId: `item-${i}`,
      checked: true,
    });
  render(<PersonGroceryAdd {...props} />);
  await typeAndSubmit("Unsubmitted groceries");
  expect(screen.getByRole("alert").textContent).toContain("Too many changes");
  expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe(
    "Unsubmitted groceries",
  );
  expect(raw).not.toContain("Unsubmitted groceries");
});
it("shows the common storage warning for memory-only submitted adds and does not promise durability", async () => {
  mockQueue.dispose();
  store.write = async () => {
    throw Error("storage unavailable");
  };
  mockQueue = buildQueue();
  render(
    <ToastProvider>
      <ListDetailClient
        {...props}
        listName="Groceries"
        listType="grocery"
        items={[]}
      />
    </ToastProvider>,
  );
  await typeAndSubmit();
  await screen.findByTestId("not-durable-banner");
  expect(screen.getByTestId("not-durable-banner").textContent).toContain(
    "Keep this page open until they sync",
  );
  expect(screen.getByText(/Grocery add queued in this page/)).toBeDefined();
});
it("an expired create exposes check/remove guidance instead of an unsafe retry", async () => {
  await mockQueue.enqueue("list-item.grocery-add", {
    listId: "list-a",
    content: "Expired milk",
  });
  now += QUEUE_MAX_AGE_MS + 1;
  online = true;
  await mockQueue.drain();
  render(<PersonGroceryAdd {...props} />);
  await screen.findByTestId("queued-grocery-add");
  expect(screen.queryByRole("button", { name: "Retry add" })).toBeNull();
  expect(screen.getByText(/Check the list before adding again/)).toBeDefined();
  expect(send).not.toHaveBeenCalled();
});
it("terminal auth clears submitted/draft text and prevents another add in the old session", async () => {
  online = true;
  send.mockResolvedValue({ status: 401, body: {} });
  render(<PersonGroceryAdd {...props} />);
  await typeAndSubmit();
  await screen.findByRole("link", { name: "Sign in" });
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByTestId("queued-grocery-add")).toBeNull();
  expect(raw).toBeNull();
  expect(send).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/Grocery add queued/)).toBeNull();
});
it("canonical refreshed props render confirmed rows and remove an item deleted elsewhere", async () => {
  const base = {
    ...props,
    listName: "Groceries",
    listType: "grocery" as const,
    canDeleteItems: false,
  };
  const wrapper = render(
    <ToastProvider>
      <ListDetailClient {...base} items={[]} />
    </ToastProvider>,
  );
  await typeAndSubmit();
  await reconnect();
  expect(screen.queryByRole("checkbox", { name: /Milk/ })).toBeNull();
  const item = {
    id: "actual-item",
    content: "Canonical milk",
    checked: false,
    quantity: 1,
    category: null,
    added_by: { name: "Parent" },
  };
  wrapper.rerender(
    <ToastProvider>
      <ListDetailClient {...base} items={[item]} />
    </ToastProvider>,
  );
  await screen.findByRole("checkbox", { name: /Canonical milk/ });
  wrapper.rerender(
    <ToastProvider>
      <ListDetailClient {...base} items={[]} />
    </ToastProvider>,
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("checkbox", { name: /Canonical milk/ }),
    ).toBeNull(),
  );
});
it("late persistence of a previous list cannot clear a new list draft or report it as queued there", async () => {
  mockQueue.dispose();
  let save!: () => void;
  store.write = async (value) => {
    raw = value;
    await new Promise<void>((r) => {
      save = r;
    });
  };
  mockQueue = buildQueue();
  const wrapper = render(<PersonGroceryAdd {...props} />);
  await typeAndSubmit("First-list milk");
  wrapper.rerender(<PersonGroceryAdd {...props} listId="list-b" />);
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "New list draft" },
  });
  await act(async () => {
    save();
  });
  expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe(
    "New list draft",
  );
  expect(screen.queryByText(/Grocery add queued/)).toBeNull();
});

it("a deleted canonical row keeps its queued tick as disabled recovery until discarded", async () => {
  const base = {
    ...props,
    listName: "Groceries",
    listType: "grocery" as const,
    canDeleteItems: false,
  };
  const item = {
    id: "actual-item",
    content: "Milk",
    checked: false,
    quantity: 1,
    category: null,
    added_by: { name: "Parent" },
  };
  const wrapper = render(
    <ToastProvider>
      <ListDetailClient {...base} items={[item]} />
    </ToastProvider>,
  );
  fireEvent.click(screen.getByRole("checkbox", { name: /Milk/ }));
  await waitFor(() => expect(mockQueue.list()).toHaveLength(1));
  wrapper.rerender(
    <ToastProvider>
      <ListDetailClient {...base} items={[]} />
    </ToastProvider>,
  );
  await screen.findByText(
    "Removed from the list. Discard this pending change.",
  );
  expect(
    screen
      .getByRole("checkbox", { name: /Milk/ })
      .getAttribute("aria-disabled"),
  ).toBe("true");
  send.mockResolvedValue({ status: 404, body: { error: "Item not found" } });
  await reconnect();
  fireEvent.click(
    await screen.findByRole("button", { name: "Discard change to Milk" }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("checkbox", { name: /Milk/ })).toBeNull(),
  );
  expect(mockQueue.list()).toHaveLength(0);
});
