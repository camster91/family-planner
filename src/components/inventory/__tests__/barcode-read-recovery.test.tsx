/** @jest-environment jsdom */
// Authored UNRUN: foreground body deadlines and retired-sheet read callbacks.
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "@/i18n";
import { BarcodeFoodDialog } from "../BarcodeFoodDialog";
const mockIntake = jest.fn();
const mockStop = jest.fn();
const mockVideo = { current: null };
jest.mock("../InventoryRecovery", () => ({ useInventoryWrites: () => ({ intake: mockIntake }) }));
jest.mock("../use-food-barcode-camera", () => ({ useFoodBarcodeCamera: () => ({ video: mockVideo, active: false, error: null, start: jest.fn(), stop: mockStop }) }));
const context = { userId: "fixture-person", familyId: "fixture-family" };
const originalFetch = global.fetch;
beforeEach(() => { jest.useFakeTimers(); mockIntake.mockReset(); });
afterEach(() => { global.fetch = originalFetch; jest.useRealTimers(); });
function start() {
  fireEvent.change(screen.getByLabelText("Printed barcode"), { target: { value: "036000291452" } });
  fireEvent.click(screen.getByRole("button", { name: "Add code to review" }));
}
it("releases a product read stalled in its body and preserves manual review", async () => {
  let finish!: (value: unknown) => void;
  const body = new Promise(resolve => { finish = resolve; });
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: () => body })) as unknown as typeof fetch;
  const done = jest.fn();
  const view = render(<I18nProvider locale="en"><BarcodeFoodDialog initialContext={context} onClose={jest.fn()} onDone={done} /></I18nProvider>);
  start();
  await act(async () => { await Promise.resolve(); });
  await act(async () => { jest.advanceTimersByTime(10000); });
  expect(screen.getByText(/Product details are unavailable/)).toBeInTheDocument();
  expect(screen.getByLabelText("Food name")).toBeEnabled();
  expect(mockIntake).not.toHaveBeenCalled();
  expect(done).not.toHaveBeenCalled();
  await act(async () => { finish({ context, barcode: "00036000291452", product: null, publicLookupAvailable: false }); });
  expect(screen.getByText(/Product details are unavailable/)).toBeInTheDocument();
  view.unmount();
});
it("does not deliver a late access callback after suspension even when fetch ignores abort", async () => {
  let finish!: (value: unknown) => void;
  global.fetch = jest.fn(() => new Promise(resolve => { finish = resolve; })) as unknown as typeof fetch;
  const verify = jest.fn();
  const props = { initialContext: context, onClose: jest.fn(), onDone: jest.fn(), onVerifyAccess: verify };
  const view = render(<I18nProvider locale="en"><BarcodeFoodDialog {...props} /></I18nProvider>);
  start();
  await act(async () => { await Promise.resolve(); });
  view.rerender(<I18nProvider locale="en"><BarcodeFoodDialog {...props} suspended /></I18nProvider>);
  const json = jest.fn(() => new Promise(() => undefined));
  await act(async () => { finish({ ok: false, status: 401, json }); });
  expect(verify).not.toHaveBeenCalled();
  expect(json).not.toHaveBeenCalled();
  expect(mockIntake).not.toHaveBeenCalled();
  view.unmount();
});
