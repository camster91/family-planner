/** @jest-environment jsdom */
import * as React from "react";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import SyncDiagnostics from "../SyncDiagnostics";
import { I18nProvider, useTranslation } from "@/i18n";
import { readPersonQueueDiagnostics } from "@/lib/person-queue-browser";

jest.mock("@/lib/person-queue-browser", () => ({
  readPersonQueueDiagnostics: jest.fn(),
}));
const read = jest.mocked(readPersonQueueDiagnostics);
const report = {
  version: 1 as const,
  depth: 2,
  states: { pending: 1, syncing: 0, failed: 0, conflict: 1 },
  durable: true,
  dropped: 0,
  replay: {
    attempts: 3,
    completed: 3,
    successes: 1,
    failures: 2,
    conflicts: 1,
  },
  rates: { success: 1 / 3, failure: 2 / 3, conflict: 1 / 3 },
};

beforeEach(() => {
  read.mockReset();
  read.mockReturnValue(report);
});

it("does nothing until requested and copies only the content-free projection", async () => {
  const writeText = jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  render(<SyncDiagnostics userId="private-viewer-id" />);
  expect(read).not.toHaveBeenCalled();
  expect(screen.queryByTestId("sync-diagnostics-report")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "View sync details" }));
  expect(read).toHaveBeenCalledWith("private-viewer-id");
  expect(screen.getByText(/2 queued changes/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Copy sync report" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
  expect(JSON.parse(writeText.mock.calls[0][0])).toEqual(report);
  expect(writeText.mock.calls[0][0]).not.toContain("private-viewer-id");
  await waitFor(() =>
    expect(screen.getByText(/Copied. Nothing was sent/)).toBeTruthy(),
  );
});

it("labels an unloaded queue instead of claiming it has no failures", () => {
  read.mockReturnValue(null);
  render(<SyncDiagnostics userId="viewer" />);
  fireEvent.click(screen.getByRole("button", { name: "View sync details" }));
  expect(screen.getByText(/Open a grocery list first/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Copy sync report" })).toBeNull();
});

it("retains a selectable report when clipboard access fails", async () => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: jest.fn().mockRejectedValue(Error("denied")) },
  });
  render(<SyncDiagnostics userId="viewer" />);
  fireEvent.click(screen.getByRole("button", { name: "View sync details" }));
  fireEvent.click(screen.getByRole("button", { name: "Copy sync report" }));
  await waitFor(() => expect(screen.getByText(/Could not copy/)).toBeTruthy());
  expect(screen.getByTestId("sync-diagnostics-report").textContent).toBe(
    JSON.stringify(report, null, 2),
  );
});

// Additional source cases authored during the no-QA pass; not executed.
function LanguageControl() {
  const { setLocale } = useTranslation();
  return <button onClick={() => setLocale("es")}>Fixture language</button>;
}
it("updates a mounted copy notice and labels without re-reading or changing report bytes", async () => {
  const writeText = jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  render(<I18nProvider locale="en" persistLocale={false}>
    <LanguageControl /><SyncDiagnostics userId="fixture-viewer" />
  </I18nProvider>);
  fireEvent.click(screen.getByRole("button", { name: "View sync details" }));
  const raw = screen.getByTestId("sync-diagnostics-report");
  fireEvent.click(screen.getByRole("button", { name: "Copy sync report" }));
  await screen.findByText(/Copied. Nothing was sent/);
  fireEvent.click(screen.getByRole("button", { name: "Fixture language" }));
  expect(screen.getByRole("heading", { name: "¿Problemas de sincronización?" })).toBeTruthy();
  expect(screen.getByText(/Copiado. No se ha enviado nada/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Copiar informe de sincronización" })).toBeTruthy();
  expect(screen.getByTestId("sync-diagnostics-report")).toBe(raw);
  expect(raw.textContent).toBe(JSON.stringify(report, null, 2));
  expect(writeText.mock.calls[0][0]).toBe(JSON.stringify(report, null, 2));
  expect(read).toHaveBeenCalledTimes(1);
});
it("does not restore a prior owner's report or late copy notice after switching accounts", async () => {
  let complete!: () => void;
  const writeText = jest.fn(() => new Promise<void>(resolve => { complete = resolve; }));
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const view = render(<SyncDiagnostics userId="fixture-first" />);
  fireEvent.click(screen.getByRole("button", { name: "View sync details" }));
  fireEvent.click(screen.getByRole("button", { name: "Copy sync report" }));
  view.rerender(<SyncDiagnostics userId="fixture-second" />);
  expect(screen.queryByTestId("sync-diagnostics-report")).toBeNull();
  read.mockReturnValue(null);
  fireEvent.click(screen.getByRole("button", { name: "View sync details" }));
  await act(async () => { complete(); });
  expect(screen.getByText(/Open a grocery list first/)).toBeTruthy();
  expect(screen.queryByText(/Copied. Nothing was sent/)).toBeNull();
  expect(screen.queryByTestId("sync-diagnostics-report")).toBeNull();
  expect(read).toHaveBeenLastCalledWith("fixture-second");
});
it("uses singular count grammar and keeps in-memory durability explicit", () => {
  read.mockReturnValue({ ...report, depth: 1, durable: false, replay: {
    ...report.replay, successes: 1, failures: 1,
  } });
  render(<I18nProvider locale="es" persistLocale={false}>
    <SyncDiagnostics userId="fixture-viewer" />
  </I18nProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Ver detalles de sincronización" }));
  expect(screen.getByText(/1 cambio pendiente\. 1 envío correcto\. 1 envío fallido\./)).toBeTruthy();
  expect(screen.getByText(/Los cambios solo están en la memoria/)).toBeTruthy();
});
