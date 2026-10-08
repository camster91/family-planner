/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DeviceGroceryAdd } from "../DeviceGroceryAdd";
import { DeviceApiError, type DeviceClient } from "@/lib/device-client";

const lists = [{ id: "list-a", name: "Groceries" }];

function setup(
  options: {
    request?: jest.Mock;
    actorId?: string | null;
    lists?: typeof lists;
    prepare?: jest.Mock;
  } = {},
) {
  const request =
    options.request ??
    jest.fn().mockResolvedValue({ item: { id: "new-item" } });
  const afterChange = jest.fn();
  const prepare = options.prepare ?? jest.fn().mockResolvedValue(true);
  const props = {
    client: { request } as unknown as DeviceClient,
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

afterEach(() => {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
});

it("discards the draft on page hide and ignores a late successful response", async () => {
  let resolve!: (value: unknown) => void;
  const request = jest.fn(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const { afterChange } = setup({ request });
  fireEvent.change(await open(), { target: { value: "Private draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Add item" }));
  fireEvent(window, new Event("pagehide"));
  expect(screen.queryByRole("textbox", { name: "Item" })).toBeNull();
  resolve({});
  await waitFor(() => expect(afterChange).toHaveBeenCalledTimes(1));
  expect(screen.queryByText("Item added to the grocery list.")).toBeNull();
  const input = await open();
  expect(input).toHaveValue("");
});

it("adds to an empty canonical list with member attribution and refreshes only after confirmation", async () => {
  const { request, prepare, afterChange } = setup();
  fireEvent.change(await open(), { target: { value: "  Milk  " } });
  fireEvent.click(screen.getByRole("button", { name: "Add item" }));
  await screen.findByRole("status");
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith(
    "/api/device/lists/list-a/items",
    expect.objectContaining({
      method: "POST",
      body: { content: "Milk", actingMemberId: "member-a" },
      headers: { "Idempotency-Key": expect.any(String) },
    }),
  );
  expect(afterChange).toHaveBeenCalledTimes(1);
});

it("retries the identical request after a lost response even if the current member changes", async () => {
  const request = jest
    .fn()
    .mockRejectedValueOnce(new DeviceApiError(0, "NETWORK_ERROR", "offline"))
    .mockResolvedValueOnce({ item: { id: "new-item" } });
  const { props, rerender, afterChange } = setup({ request });
  fireEvent.change(await open(), { target: { value: "Milk" } });
  fireEvent.click(screen.getByRole("button", { name: "Add item" }));
  await screen.findByRole("alert");
  expect(afterChange).not.toHaveBeenCalled();
  expect(screen.getByRole("textbox", { name: "Item" })).toBeDisabled();
  rerender(<DeviceGroceryAdd {...props} actorId="member-b" />);
  fireEvent.click(screen.getByRole("button", { name: "Retry add" }));
  await waitFor(() => expect(afterChange).toHaveBeenCalledTimes(1));
  expect(request.mock.calls[1]).toEqual(request.mock.calls[0]);
});

it("requires a deliberate choice when there are multiple lists", async () => {
  const { request } = setup({
    lists: [...lists, { id: "list-b", name: "Weekend" }],
  });
  fireEvent.change(await open(), { target: { value: "Milk" } });
  fireEvent.click(screen.getByRole("button", { name: "Add item" }));
  await screen.findByRole("alert");
  expect(request).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("combobox", { name: "Grocery list" }), {
    target: { value: "list-b" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add item" }));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      "/api/device/lists/list-b/items",
      expect.any(Object),
    ),
  );
});

it("shows personal-device setup when no list exists, without picking a member or creating data", async () => {
  const { prepare, request } = setup({ lists: [] });
  fireEvent.click(screen.getByRole("button", { name: "Add grocery" }));
  await screen.findByText(
    /Create a grocery list on your personal device first/,
  );
  expect(prepare).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
});

it("does not send or queue a new item offline", async () => {
  const { request } = setup();
  fireEvent.change(await open(), { target: { value: "Milk" } });
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: false,
  });
  fireEvent.click(screen.getByRole("button", { name: "Add item" }));
  await screen.findByRole("alert");
  expect(request).not.toHaveBeenCalled();
  expect(screen.getByRole("textbox", { name: "Item" })).toHaveValue("Milk");
});

it("allows correction after definitive validation failure", async () => {
  const { request } = setup({
    request: jest
      .fn()
      .mockRejectedValueOnce(
        new DeviceApiError(400, "VALIDATION_ERROR", "Use 1 to 200 characters."),
      )
      .mockResolvedValueOnce({}),
  });
  fireEvent.change(await open(), { target: { value: "Milk" } });
  fireEvent.click(screen.getByRole("button", { name: "Add item" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("textbox", { name: "Item" })).not.toBeDisabled();
  fireEvent.change(screen.getByRole("textbox", { name: "Item" }), {
    target: { value: "Bread" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add item" }));
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  expect(request.mock.calls[1][1].body.content).toBe("Bread");
  expect(request.mock.calls[1][1].headers).not.toEqual(
    request.mock.calls[0][1].headers,
  );
});
