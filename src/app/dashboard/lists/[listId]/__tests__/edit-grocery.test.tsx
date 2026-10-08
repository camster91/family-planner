/** @jest-environment jsdom */
import * as React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditGroceryDialog, type EditableGrocery } from "../EditGroceryDialog";

const initial: EditableGrocery = {
  id: "item-a",
  content: "Milk",
  quantity: 1,
  updated_at: "2026-01-01T00:00:00.000Z",
};
const latest: EditableGrocery = {
  ...initial,
  content: "Bread",
  quantity: 2,
  updated_at: "2026-01-01T00:00:00.001Z",
};
const response = (status: number, body: unknown = {}) =>
  ({ ok: status < 300, status, json: async () => body }) as Response;
const props = () => ({
  initial,
  current: initial,
  online: true,
  onClose: jest.fn(),
  onRefresh: jest.fn(),
});
beforeEach(() => {
  global.fetch = jest.fn();
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
});

it("confirmed saves reload canonical values rather than insert a possibly stale replay", async () => {
  jest
    .mocked(fetch)
    .mockResolvedValue(
      response(200, { success: true, item: { content: "Old cached value" } }),
    );
  const p = props();
  render(<EditGroceryDialog {...p} />);
  await userEvent.clear(screen.getByLabelText("Item name"));
  await userEvent.type(screen.getByLabelText("Item name"), "Oat milk");
  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(p.onClose).toHaveBeenCalledTimes(1));
  expect(p.onRefresh).toHaveBeenCalledTimes(1);
  const [url, config] = jest.mocked(fetch).mock.calls[0];
  expect(url).toBe("/api/lists/items/edit");
  expect(JSON.parse(String(config?.body))).toEqual({
    itemId: initial.id,
    content: "Oat milk",
    quantity: 1,
    expectedUpdatedAt: initial.updated_at,
  });
  expect(
    (config?.headers as Record<string, string>)["Idempotency-Key"],
  ).toMatch(/^[0-9a-f-]{36}$/);
});
it("offline saves send nothing and keep the draft in the open editor", async () => {
  render(<EditGroceryDialog {...props()} online={false} />);
  await userEvent.type(screen.getByLabelText("Item name"), " and eggs");
  expect(
    (screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect((screen.getByLabelText("Item name") as HTMLInputElement).value).toBe(
    "Milk and eggs",
  );
  expect(fetch).not.toHaveBeenCalled();
});
it("a lost response freezes the intent and the retry sends the exact same body and key", async () => {
  jest
    .mocked(fetch)
    .mockRejectedValueOnce(new Error("Lost response"))
    .mockResolvedValueOnce(response(200, { success: true }));
  const p = props();
  render(<EditGroceryDialog {...p} />);
  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByRole("button", { name: "Retry save" });
  expect(
    (screen.getByLabelText("Item name") as HTMLInputElement).disabled,
  ).toBe(true);
  await userEvent.click(screen.getByRole("button", { name: "Retry save" }));
  await waitFor(() => expect(p.onClose).toHaveBeenCalled());
  expect(jest.mocked(fetch).mock.calls[1]).toEqual(
    jest.mocked(fetch).mock.calls[0],
  );
});
it("a stale response retains the draft until current values are explicitly adopted", async () => {
  jest
    .mocked(fetch)
    .mockResolvedValue(response(409, { error: { code: "LIST_ITEM_CHANGED" } }));
  const p = props();
  const view = render(<EditGroceryDialog {...p} />);
  await userEvent.type(screen.getByLabelText("Item name"), " draft");
  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(p.onRefresh).toHaveBeenCalled());
  expect(
    (screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  view.rerender(<EditGroceryDialog {...p} current={latest} />);
  expect((screen.getByLabelText("Item name") as HTMLInputElement).value).toBe(
    "Milk draft",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Use current values" }),
  );
  expect((screen.getByLabelText("Item name") as HTMLInputElement).value).toBe(
    "Bread",
  );
  jest.mocked(fetch).mockResolvedValue(response(200, { success: true }));
  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(p.onClose).toHaveBeenCalled());
  const second = jest.mocked(fetch).mock.calls[1][1]!;
  expect(JSON.parse(String(second.body))).toMatchObject({
    expectedUpdatedAt: latest.updated_at,
    content: "Bread",
    quantity: 2,
  });
  expect(second.headers).not.toEqual(
    jest.mocked(fetch).mock.calls[0][1]?.headers,
  );
});
it("a removed item disables saving and cannot be added back through the editor", async () => {
  render(<EditGroceryDialog {...props()} current={null} />);
  expect(screen.getByText(/no longer on the list/)).toBeTruthy();
  expect(
    (screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
});
it("access denial cannot be cleared by a newer snapshot", async () => {
  jest.mocked(fetch).mockResolvedValue(response(403));
  const p = props();
  const view = render(<EditGroceryDialog {...p} />);
  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByText(/no longer have access/);
  view.rerender(<EditGroceryDialog {...p} current={latest} />);
  expect(
    screen.queryByRole("button", { name: "Use current values" }),
  ).toBeNull();
  expect(
    (screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});
it("pending writes prevent duplicate submit, input changes and dismissal", async () => {
  let finish!: (value: Response) => void;
  jest.mocked(fetch).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const p = props();
  render(
    <React.StrictMode>
      <EditGroceryDialog {...p} />
    </React.StrictMode>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
  expect(
    (screen.getByLabelText("Item name") as HTMLInputElement).disabled,
  ).toBe(true);
  expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  await userEvent.keyboard("{Escape}");
  expect(p.onClose).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledTimes(1);
  finish(response(200, { success: true }));
  await waitFor(() => expect(p.onClose).toHaveBeenCalled());
});
