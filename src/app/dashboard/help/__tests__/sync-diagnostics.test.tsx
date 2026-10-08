/** @jest-environment jsdom */
import * as React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SyncDiagnostics from "../SyncDiagnostics";
import { readPersonQueueDiagnostics } from "@/lib/offline-queue-browser";

jest.mock("@/lib/offline-queue-browser", () => ({
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
