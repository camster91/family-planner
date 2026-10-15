/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import * as React from "react";
import { act, fireEvent, render as renderWithProvider, screen, waitFor } from "@testing-library/react";
import type { OfflineQueue, QueueEvent } from "@/lib/offline-queue";
import { I18nProvider } from "@/i18n";
import { QueueStorageRecovery } from "../queue-storage-recovery";

function render(ui: React.ReactNode) {
  return renderWithProvider(ui, {
    wrapper: ({ children }) => <I18nProvider locale="en">{children}</I18nProvider>,
  });
}

function fixture() {
  let blocked = true;
  const listeners = new Set<(event: QueueEvent) => void>();
  const queue = {
    ready: Promise.resolve(),
    hasStorageReadError: () => blocked,
    subscribe: (fn: (event: QueueEvent) => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    retryStorageRead: jest.fn().mockResolvedValue(undefined),
  } as unknown as OfflineQueue;
  return {
    queue,
    recover() {
      blocked = false;
      listeners.forEach(fn => fn({ type: "change" }));
    },
  };
}

it("offers one deliberate read retry and hides only after recovery", async () => {
  const f = fixture();
  let finish!: () => void;
  jest.mocked(f.queue.retryStorageRead).mockImplementation(() => new Promise(resolve => {
    finish = () => { f.recover(); resolve(); };
  }));
  render(<QueueStorageRecovery queue={f.queue} />);
  const retry = await screen.findByRole("button", { name: "Try loading saved changes" });
  expect(screen.getByRole("status")).toHaveTextContent("New changes are paused to protect them.");
  fireEvent.click(retry);
  fireEvent.click(retry);
  expect(f.queue.retryStorageRead).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Loading saved changes…" })).toBeDisabled();
  await act(async () => finish());
  await waitFor(() => expect(screen.queryByTestId("queue-storage-recovery")).not.toBeInTheDocument());
});

it("keeps recovery available after an unsuccessful read without exposing the error", async () => {
  const f = fixture();
  jest.mocked(f.queue.retryStorageRead).mockRejectedValue(new Error("private storage details"));
  render(<QueueStorageRecovery queue={f.queue} />);
  fireEvent.click(await screen.findByRole("button", { name: "Try loading saved changes" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Try loading saved changes" })).toBeEnabled());
  expect(screen.getByRole("status")).not.toHaveTextContent("private storage details");
  expect(screen.getByTestId("queue-storage-recovery")).toBeVisible();
});

it("does not let an old queue's late retry replace the current account state", async () => {
  const old = fixture(), current = fixture();
  let finish!: () => void;
  jest.mocked(old.queue.retryStorageRead).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<QueueStorageRecovery queue={old.queue} />);
  fireEvent.click(await screen.findByRole("button", { name: "Try loading saved changes" }));
  view.rerender(<QueueStorageRecovery queue={current.queue} />);
  await screen.findByRole("button", { name: "Try loading saved changes" });
  await act(async () => { old.recover(); finish(); });
  expect(screen.getByRole("button", { name: "Try loading saved changes" })).toBeEnabled();
  expect(current.queue.retryStorageRead).not.toHaveBeenCalled();
});

it("uses Spanish recovery copy and has no discard or clear-storage control", async () => {
  const f = fixture();
  render(<I18nProvider locale="es"><QueueStorageRecovery queue={f.queue} /></I18nProvider>);
  expect(await screen.findByRole("button", { name: "Intentar cargar los cambios guardados" })).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("Los cambios nuevos están en pausa");
  expect(screen.getAllByRole("button")).toHaveLength(1);
});
