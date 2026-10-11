/** @jest-environment jsdom */
import * as React from "react";
import "@testing-library/jest-dom";
import {
  act,
  fireEvent,
  render as renderWithProvider,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { I18nProvider, useTranslation } from "@/i18n";
import { DeviceGroceryAdd } from "../DeviceGroceryAdd";
import { DeviceApiError, type DeviceClient } from "@/lib/device-client";
import {
  createOfflineQueue,
  QUEUE_MAX_AGE_MS,
  QUEUE_MAX_OPS,
  type OfflineQueue,
} from "@/lib/offline-queue";
import { deviceQueueSend } from "@/lib/offline-queue-browser";

let changeLocale: (locale: "en" | "es") => void;
function LocaleControl() {
  changeLocale = useTranslation().setLocale;
  return null;
}
function render(ui: React.ReactNode) {
  return renderWithProvider(ui, {
    wrapper: ({ children }) => (
      <I18nProvider locale="en">
        <LocaleControl />
        {children}
      </I18nProvider>
    ),
  });
}

let mockQueue: OfflineQueue;
jest.mock("@/lib/offline-queue-browser", () => ({
  ...jest.requireActual("@/lib/offline-queue-browser"),
  getDeviceQueue: () => mockQueue,
}));
const lists = [{ id: "list-a", name: "Groceries" }];
let now = 1_000_000;
let saved: string | null = null;
function setup(
  options: {
    request?: jest.Mock;
    actorId?: string | null;
    lists?: typeof lists;
    prepare?: jest.Mock;
    blockedStore?: boolean;
    initial?: string | null;
  } = {},
) {
  const request =
    options.request ??
    jest.fn().mockResolvedValue({ item: { id: "new-item" } });
  const client = { request } as unknown as DeviceClient;
  saved = options.initial ?? null;
  let key = 0;
  mockQueue = createOfflineQueue({
    namespace: "device",
    store: {
      read: async () => saved,
      write: async (v) => {
        if (options.blockedStore) throw Error("quota");
        saved = v;
      },
      remove: async () => {
        saved = null;
      },
    },
    send: deviceQueueSend(client),
    now: () => now,
    random: () => 0.5,
    newKey: () => `queued-add-key-${++key}-abcdefghijkl`,
    isOnline: () => navigator.onLine,
    setTimer: () => null,
    clearTimer: () => {},
  });
  const afterChange = jest.fn(),
    prepare = options.prepare ?? jest.fn().mockResolvedValue(true);
  const props = {
    client,
    lists: options.lists ?? lists,
    actorId: options.actorId === undefined ? "member-a" : options.actorId,
    prepare,
    afterChange,
  };
  const view = render(<DeviceGroceryAdd {...props} />);
  return { ...view, props, request, prepare, afterChange };
}
async function open() {
  fireEvent.click(screen.getByRole("button", { name: "Add grocery" }));
  return screen.findByRole("textbox", { name: "Item" });
}
async function add(text = "Milk") {
  fireEvent.change(await open(), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Add item" }));
}
function connection(online: boolean) {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: online,
  });
  fireEvent(window, new Event(online ? "online" : "offline"));
}
beforeEach(() => {
  now = 1_000_000;
  connection(true);
});
afterEach(() => {
  mockQueue?.abandon();
  connection(true);
});

it("adds with member attribution and refreshes only after canonical confirmation", async () => {
  const { request, afterChange, prepare } = setup();
  await add("  Milk  ");
  await screen.findByText("Item added to the grocery list.");
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(afterChange).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith(
    "/api/device/lists/list-a/items",
    expect.objectContaining({
      method: "POST",
      body: { content: "Milk", actingMemberId: "member-a" },
      headers: { "Idempotency-Key": expect.any(String) },
    }),
  );
  expect(saved).toBeNull();
});
it("queues a new item offline, shows pending state and replays the same request on reconnect", async () => {
  const { request, afterChange } = setup();
  connection(false);
  await add();
  await screen.findByText("Waiting to add when connected.");
  expect(request).not.toHaveBeenCalled();
  expect(afterChange).not.toHaveBeenCalled();
  expect(screen.queryByRole("textbox", { name: "Item" })).toBeNull();
  const stored = JSON.parse(saved!).ops[0];
  expect(stored.payload).toEqual({
    listId: "list-a",
    content: "Milk",
    actingMemberId: "member-a",
  });
  connection(true);
  await act(async () => {
    await mockQueue.handleOnline();
  });
  await screen.findByText("Item added to the grocery list.");
  expect(request.mock.calls[0][1].headers["Idempotency-Key"]).toBe(stored.id);
});
it("retains an uncertain add outside the dialog and retries the same body/key after actor changes", async () => {
  const request = jest
    .fn()
    .mockRejectedValueOnce(new DeviceApiError(0, "NETWORK_ERROR", "offline"))
    .mockResolvedValueOnce({});
  const { props, rerender, afterChange } = setup({ request });
  await add();
  await screen.findByText("Waiting to add when connected.");
  expect(afterChange).not.toHaveBeenCalled();
  rerender(<DeviceGroceryAdd {...props} actorId="member-b" />);
  fireEvent.click(screen.getByRole("button", { name: "Try now" }));
  await screen.findByText("Item added to the grocery list.");
  expect(request.mock.calls[1]).toEqual(request.mock.calls[0]);
});
it("clears an unsubmitted draft on hide; a submitted operation stays durable across unmount", async () => {
  const { unmount } = setup();
  connection(false);
  fireEvent.change(await open(), { target: { value: "Private draft" } });
  fireEvent(window, new Event("pagehide"));
  expect(screen.queryByRole("textbox", { name: "Item" })).toBeNull();
  expect(saved).toBeNull();
  expect(await open()).toHaveValue("");
  fireEvent.change(screen.getByRole("textbox", { name: "Item" }), {
    target: { value: "Milk" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add item" }));
  await screen.findByText("Waiting to add when connected.");
  const stored = saved;
  unmount();
  mockQueue.dispose();
  const next = setup({ initial: stored });
  await screen.findByText("Milk");
  expect(next.request).not.toHaveBeenCalled();
  expect(mockQueue.list()[0].id).toBe(JSON.parse(stored!).ops[0].id);
});
it("shows a removed-list conflict without removing the tablet, and discards only local intent", async () => {
  const { afterChange, request } = setup({
    request: jest
      .fn()
      .mockRejectedValue(new DeviceApiError(404, "NOT_FOUND", "missing")),
  });
  await add();
  await screen.findByText("That list is no longer available or has changed.");
  expect(afterChange).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Remove queued add" }));
  await screen.findByText(/Check the list before adding it again/);
  expect(request).toHaveBeenCalledTimes(1);
  expect(saved).toBeNull();
});
it("retains definitive failures for explicit recovery, without silently changing their actor/body", async () => {
  const request = jest
    .fn()
    .mockRejectedValueOnce(new DeviceApiError(400, "VALIDATION_ERROR", "bad"))
    .mockResolvedValueOnce({});
  setup({ request });
  await add();
  await screen.findByText("Could not add this item.");
  fireEvent.click(screen.getByRole("button", { name: "Retry add" }));
  await screen.findByText("Item added to the grocery list.");
  expect(request.mock.calls[1]).toEqual(request.mock.calls[0]);
});
it("requires an explicit list selection and fresh member selection", async () => {
  const { request, rerender, props } = setup({
    lists: [...lists, { id: "list-b", name: "Weekend" }],
  });
  await add();
  await screen.findByRole("alert");
  expect(request).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("combobox", { name: "Grocery list" }), {
    target: { value: "list-b" },
  });
  rerender(<DeviceGroceryAdd {...props} actorId={null} />);
  fireEvent.click(screen.getByRole("button", { name: "Add item" }));
  await screen.findByText(/Your name selection expired/);
  expect(request).not.toHaveBeenCalled();
  rerender(<DeviceGroceryAdd {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Add item" }));
  await screen.findByText("Item added to the grocery list.");
  expect(request.mock.calls[0][0]).toBe("/api/device/lists/list-b/items");
});
it("shows personal-device setup when no list exists without creating a list or selecting a member", async () => {
  const { prepare, request } = setup({ lists: [] });
  fireEvent.click(screen.getByRole("button", { name: "Add grocery" }));
  await screen.findByText(
    /Create a grocery list on your personal device first/,
  );
  expect(prepare).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
});
it("keeps text when the bounded queue is full", async () => {
  setup();
  connection(false);
  await act(async () => {
    for (let i = 0; i < QUEUE_MAX_OPS; i++)
      await mockQueue.enqueue("device.list-item.add", {
        listId: "list-a",
        content: "Existing " + i,
        actingMemberId: "member-a",
      });
  });
  await add("New milk");
  await screen.findByText(/Too many changes are waiting/);
  expect(screen.getByRole("textbox", { name: "Item" })).toHaveValue("New milk");
});
it("warns when storage fails and does not label the add as saved remotely", async () => {
  setup({ blockedStore: true });
  connection(false);
  await add();
  await screen.findByText(
    "Changes are only in memory. Keep this page open until they sync.",
  );
  expect(screen.queryByText("Item added to the grocery list.")).toBeNull();
});
it("does not offer to retry an expired create with a renewed key or timestamp", async () => {
  const { request } = setup();
  connection(false);
  await add();
  await screen.findByText("Waiting to add when connected.");
  now += QUEUE_MAX_AGE_MS + 1;
  connection(true);
  await act(async () => {
    await mockQueue.handleOnline();
  });
  await screen.findByText(/This add cannot safely be retried/);
  expect(request).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Retry add" })).toBeNull();
});
it("never offers discard while a send is in flight and reports no confirmation before it finishes", async () => {
  let resolve!: (v: unknown) => void;
  const request = jest.fn(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const { afterChange } = setup({ request });
  await add();
  const pending = await screen.findByTestId("queued-grocery-add");
  expect(within(pending).getByText("Adding…")).toBeTruthy();
  expect(within(pending).queryByRole("button")).toBeNull();
  expect(afterChange).not.toHaveBeenCalled();
  await act(async () => {
    resolve({});
    await mockQueue.drain();
  });
  await screen.findByText("Item added to the grocery list.");
});

it("changes language without clearing a device draft, reattributing a queued add or resetting its key", async () => {
  connection(false);
  const { request, afterChange } = setup();
  await add("Leche {name} 🥛");
  await screen.findByText("Add queued. Check its status below.");
  const stored = JSON.parse(saved!).ops[0];
  fireEvent.change(await open(), { target: { value: "Next unsent draft" } });
  act(() => changeLocale("es"));
  expect(screen.getByRole("textbox", { name: "Artículo" })).toHaveValue(
    "Next unsent draft",
  );
  expect(
    screen.getByRole("combobox", { name: "Lista de compras" }),
  ).toHaveValue("list-a");
  expect(screen.getByRole("button", { name: "Cerrar" })).toBeVisible();
  expect(
    screen.getByRole("region", { name: "Añadidos de compras en espera" }),
  ).toHaveTextContent("Leche {name} 🥛");
  expect(JSON.parse(saved!).ops[0]).toEqual(stored);
  expect(request).not.toHaveBeenCalled();
  connection(true);
  await act(async () => {
    await mockQueue.handleOnline();
  });
  await screen.findByText("Artículo añadido a la lista de compras.");
  expect(request).toHaveBeenCalledWith(
    "/api/device/lists/list-a/items",
    expect.objectContaining({
      body: { content: "Leche {name} 🥛", actingMemberId: "member-a" },
      headers: { "Idempotency-Key": stored.id },
    }),
  );
  expect(afterChange).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("textbox", { name: "Artículo" })).toHaveValue(
    "Next unsent draft",
  );
  act(() => changeLocale("en"));
  await screen.findByText("Item added to the grocery list.");
});

it("keeps unfamiliar shared work and refuses a new add without losing its draft", async () => {
  const original = JSON.stringify({ v: 2, ops: [{ id: "original-key-123456", action: "device.list-item.add", v: 2, payload: { content: "PRIVATE UNKNOWN TEXT" } }] });
  const { request } = setup({ initial: original });
  await screen.findByText(/Pending changes need a compatible app version/);
  expect(screen.queryByText("PRIVATE UNKNOWN TEXT")).not.toBeInTheDocument();
  await add("Keep this shared draft");
  expect(screen.getByRole("textbox", { name: "Item" })).toHaveValue("Keep this shared draft");
  expect(saved).toBe(original);
  expect(request).not.toHaveBeenCalled();
  await act(async () => changeLocale("es"));
  expect(screen.getAllByText(/Los cambios pendientes necesitan una versión compatible/).length).toBeGreaterThan(0);
});
