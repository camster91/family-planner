/** @jest-environment jsdom */
// Source authored UNRUN. No camera, provider or inventory writes.
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "@/i18n";
import { ScanFridgeDialog } from "../ScanFridgeDialog";
const mockIntake = jest.fn();
jest.mock("@/components/inventory/InventoryRecovery", () => ({ useInventoryWrites: () => ({ intake: mockIntake }) }));
const context = { userId: "fixture-person", familyId: "fixture-family" };
const originalFetch = global.fetch;
const originalBitmap = global.createImageBitmap;
beforeEach(() => { jest.useFakeTimers(); mockIntake.mockClear(); });
afterEach(() => { global.fetch = originalFetch; global.createImageBitmap = originalBitmap; jest.useRealTimers(); });
function open(verify = jest.fn()) {
  return render(<I18nProvider locale="en"><ScanFridgeDialog initialContext={context} onClose={jest.fn()} onDone={jest.fn()} onVerifyAccess={verify} /></I18nProvider>);
}
function pick() { fireEvent.change(screen.getByTestId("scan-file-input"), { target: { files: [new File(["fixture"], "food.jpg", { type: "image/jpeg" })] } }); }
it("releases a scan stalled in its response body and ignores late suggestions", async () => {
  let finish!: (value: unknown) => void;
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: () => new Promise(resolve => { finish = resolve; }) })) as unknown as typeof fetch;
  open(); pick();
  await act(async () => { await Promise.resolve(); });
  await act(async () => { jest.advanceTimersByTime(60000); });
  expect(screen.queryByTestId("scan-loading")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
  await act(async () => { finish({ items: [{ name: "Late beans", amount: 1, unit: null, location: "pantry", confidence: 0.9 }] }); });
  expect(screen.queryByTestId("scan-add")).not.toBeInTheDocument();
  expect(mockIntake).not.toHaveBeenCalled();
});
it("does not upload after late image preparation beyond the foreground deadline", async () => {
  let finish!: (value: unknown) => void;
  global.createImageBitmap = jest.fn(() => new Promise(resolve => { finish = resolve; })) as unknown as typeof createImageBitmap;
  global.fetch = jest.fn(); open(); pick();
  await act(async () => { await Promise.resolve(); });
  await act(async () => { jest.advanceTimersByTime(60000); });
  expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
  const close = jest.fn();
  await act(async () => { finish({ width: 10, height: 10, close }); });
  expect(close).toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});
it("requests current access review without consuming a stalled refusal body", async () => {
  const json = jest.fn(() => new Promise(() => undefined));
  global.fetch = jest.fn(async () => ({ ok: false, status: 403, json })) as unknown as typeof fetch;
  const verify = jest.fn(); open(verify); pick();
  await act(async () => { await Promise.resolve(); });
  expect(verify).toHaveBeenCalledTimes(1); expect(json).not.toHaveBeenCalled();
  expect(screen.getByText("You can't scan the fridge. Ask a parent.")).toBeInTheDocument();
});
it("rejects oversized response declarations without decoding suggestions", async () => {
  const json = jest.fn();
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, headers: { get: () => "300000" }, json })) as unknown as typeof fetch;
  open(); pick(); await act(async () => { await Promise.resolve(); });
  expect(screen.queryByTestId("scan-add")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
  expect(json).not.toHaveBeenCalled();
});
