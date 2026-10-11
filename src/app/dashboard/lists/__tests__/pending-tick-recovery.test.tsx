/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import * as React from "react";
import {
  act,
  render as renderWithProvider,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { I18nProvider, useTranslation } from "@/i18n";
import PendingTickRecovery from "../PendingTickRecovery";
import { getPersonQueue } from "@/lib/offline-queue-browser";

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

jest.mock("@/lib/offline-queue-browser", () => ({ getPersonQueue: jest.fn() }));
const getQueue = jest.mocked(getPersonQueue);
let ops: any[], listener: (event: any) => void;
let queue: any;
const op = (id: string, checked: boolean, state = "conflict") => ({
  id,
  action: "list-item.set-checked",
  payload: { itemId: `private-${id}`, checked },
  state,
  createdAt: 1767628800000,
});
beforeEach(() => {
  ops = [
    op("key-one", true),
    op("key-two", false, "syncing"),
    { ...op("device-key", true), action: "device.list-item.set-checked" },
  ];
  queue = {
    ready: Promise.resolve(),
    requiresCompatibleClient: () => false,
    list: () => ops,
    subscribe: jest.fn((fn) => {
      listener = fn;
      return jest.fn();
    }),
    retry: jest.fn().mockResolvedValue(undefined),
    discard: jest.fn(async (id) => {
      ops = ops.filter((o) => o.id !== id);
      listener({ type: "change" });
    }),
  };
  getQueue.mockReset();
  getQueue.mockReturnValue(queue);
});
async function open() {
  fireEvent.click(screen.getByRole("button", { name: "Review waiting ticks" }));
  await screen.findByText("Change 1: Tick an item");
}
it("loads only the signed-in queue when deliberately opened, hides IDs and device operations", async () => {
  render(<PendingTickRecovery userId="viewer" />);
  expect(getQueue).not.toHaveBeenCalled();
  await open();
  expect(getQueue).toHaveBeenCalledWith("viewer");
  expect(screen.getAllByTestId("pending-tick-recovery-row")).toHaveLength(2);
  expect(screen.getByRole("dialog").textContent).not.toMatch(
    /private-|key-one|device-key/,
  );
  expect(
    (
      screen.getByRole("button", {
        name: "Discard change 2",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(screen.queryByRole("button", { name: "Retry change 2" })).toBeNull();
});
it("keeps the same key when retrying and waits for confirmation before discarding only the chosen tick", async () => {
  render(<PendingTickRecovery userId="viewer" />);
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Retry change 1" }));
  await waitFor(() => expect(queue.retry).toHaveBeenCalledWith("key-one"));
  fireEvent.click(screen.getByRole("button", { name: "Discard change 1" }));
  expect(queue.discard).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Keep pending tick" }));
  expect(queue.discard).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Discard change 1" }));
  fireEvent.click(screen.getByRole("button", { name: "Discard pending tick" }));
  await waitFor(() => expect(queue.discard).toHaveBeenCalledWith("key-one"));
  expect(ops.some((o) => o.id === "key-two")).toBe(true);
  expect(screen.getAllByTestId("pending-tick-recovery-row")).toHaveLength(1);
});
it("clears stale confirmation on terminal auth loss", async () => {
  render(<PendingTickRecovery userId="viewer" />);
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Discard change 1" }));
  ops = [];
  const { act } = await import("@testing-library/react");
  act(() => listener({ type: "auth-lost" }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(screen.getByText("No saved ticks are waiting.")).toBeTruthy();
  expect(screen.getByText(/Your session ended/)).toBeTruthy();
});
it("labels the actual empty queue and allows closing while storage is loading", async () => {
  ops = [];
  render(<PendingTickRecovery userId="viewer" />);
  fireEvent.click(screen.getByRole("button", { name: "Review waiting ticks" }));
  await screen.findByText("No saved ticks are waiting.");
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("translates a live retry notice and open discard confirmation without subscribing again or changing the selected tick", async () => {
  render(<PendingTickRecovery userId="viewer" />);
  await open();
  const before = JSON.parse(JSON.stringify(ops));
  fireEvent.click(screen.getByRole("button", { name: "Retry change 1" }));
  await screen.findByText(
    "Retry requested. The change remains here until the server confirms it.",
  );
  fireEvent.click(screen.getByRole("button", { name: "Discard change 1" }));
  act(() => changeLocale("es"));
  expect(
    screen.getByRole("alertdialog", {
      name: "¿Descartar esta marca pendiente?",
    }),
  ).toBeVisible();
  expect(
    screen.getByText(
      "Reintento solicitado. El cambio permanece aquí hasta que el servidor lo confirme.",
    ),
  ).toBeVisible();
  expect(screen.getByText("Cambio 1: Marcar un artículo")).toBeVisible();
  expect(queue.subscribe).toHaveBeenCalledTimes(1);
  expect(getQueue).toHaveBeenCalledTimes(1);
  expect(ops).toEqual(before);
  fireEvent.click(
    screen.getByRole("button", { name: "Descartar marca pendiente" }),
  );
  await waitFor(() => expect(queue.discard).toHaveBeenCalledWith("key-one"));
  expect(
    screen.getByText(
      "Se descartó la marca pendiente. Esto no deshace un cambio ya guardado.",
    ),
  ).toBeVisible();
  expect(ops).toEqual(before.filter((op: any) => op.id !== "key-one"));
});

it("shows retained-work recovery instead of claiming there are no pending changes", async () => {
  ops = [];
  queue.requiresCompatibleClient = () => true;
  render(<PendingTickRecovery userId="viewer" />);
  fireEvent.click(screen.getByRole("button", { name: "Review waiting ticks" }));
  await screen.findByText(/Pending changes need a compatible app version/);
  expect(
    screen.queryByText("No saved ticks are waiting."),
  ).not.toBeInTheDocument();
  expect(queue.retry).not.toHaveBeenCalled();
  expect(queue.discard).not.toHaveBeenCalled();
});
