/** @jest-environment jsdom */
// Authored UNRUN; fabricated suggestions and mocked canonical intake.
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "@/i18n";
import { photoAddedFeedback } from "@/i18n/inventory";
import { ScanFridgeDialog } from "../ScanFridgeDialog";
const mockIntake = jest.fn();
const mockRelease = jest.fn(async () => true);
jest.mock("@/components/inventory/InventoryRecovery", () => ({ useInventoryWrites: () => ({ intake: mockIntake }) }));
jest.mock("@/components/layout/pending-form-navigation", () => ({ usePendingFormNavigationController: () => ({ releaseBeforeNavigation: mockRelease }) }));
const context = { userId: "fixture-person", familyId: "fixture-family" };
const originalFetch = global.fetch;
beforeEach(() => {
  mockIntake.mockReset(); mockRelease.mockClear();
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ items: ["Beans", "Milk", "Rice"].map(name => ({ name, amount: 1, unit: "packages", location: "pantry", confidence: 0.95 })), dropped: 0 }) })) as unknown as typeof fetch;
});
afterEach(() => { global.fetch = originalFetch; });
async function review() {
  fireEvent.change(screen.getByTestId("scan-file-input"), { target: { files: [new File(["fixture"], "food.jpg", { type: "image/jpeg" })] } });
  await waitFor(() => expect(screen.getByTestId("scan-add")).toBeEnabled());
}
it("keeps earlier confirmed counts, stops retired rows and retries the same in-flight intent", async () => {
  let finish!: (value: unknown) => void;
  mockIntake.mockResolvedValueOnce({ kind: "confirmed", itemId: "first-stock" });
  mockIntake.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  mockIntake.mockResolvedValue({ kind: "confirmed", itemId: "later-stock" });
  const report = jest.fn();
  const props = { initialContext: context, onClose: jest.fn(), onDone: jest.fn(), onFeedback: report };
  const view = render(<I18nProvider locale="en"><ScanFridgeDialog {...props} /></I18nProvider>);
  await review(); fireEvent.click(screen.getByTestId("scan-add"));
  await waitFor(() => expect(mockIntake).toHaveBeenCalledTimes(2));
  const original = { ...mockIntake.mock.calls[1][0] };
  view.rerender(<I18nProvider locale="en"><ScanFridgeDialog {...props} suspended /></I18nProvider>);
  view.rerender(<I18nProvider locale="en"><ScanFridgeDialog {...props} /></I18nProvider>);
  await act(async () => { finish({ kind: "confirmed", itemId: "late-stock" }); });
  expect(mockIntake).toHaveBeenCalledTimes(2); expect(report).not.toHaveBeenCalled();
  expect(mockRelease).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId("scan-add"));
  await waitFor(() => expect(mockIntake).toHaveBeenCalledTimes(4));
  expect(mockIntake.mock.calls[2][0]).toEqual(original);
  await waitFor(() => expect(report).toHaveBeenCalledWith(photoAddedFeedback(3)));
});
it("stops the next suggestion after an access refusal", async () => {
  mockIntake.mockResolvedValue({ kind: "refused", code: "AUTH_CHANGED", accessChanged: true });
  const verify = jest.fn();
  render(<I18nProvider locale="en"><ScanFridgeDialog initialContext={context} onClose={jest.fn()} onDone={jest.fn()} onVerifyAccess={verify} /></I18nProvider>);
  await review(); fireEvent.click(screen.getByTestId("scan-add"));
  await waitFor(() => expect(verify).toHaveBeenCalledTimes(1));
  expect(mockIntake).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId("scan-add")).toBeEnabled();
});
it("releases busy state after a thrown send without replacing its uncertain request", async () => {
  mockIntake.mockRejectedValueOnce(new Error("Fixture lost response"));
  mockIntake.mockResolvedValue({ kind: "unknown" });
  render(<I18nProvider locale="en"><ScanFridgeDialog initialContext={context} onClose={jest.fn()} onDone={jest.fn()} /></I18nProvider>);
  await review(); fireEvent.click(screen.getByTestId("scan-add"));
  await waitFor(() => expect(mockIntake).toHaveBeenCalledTimes(3));
  await waitFor(() => expect(screen.getByTestId("scan-add")).toBeEnabled());
  const original = { ...mockIntake.mock.calls[0][0] };
  fireEvent.click(screen.getByTestId("scan-add"));
  await waitFor(() => expect(mockIntake).toHaveBeenCalledTimes(6));
  expect(mockIntake.mock.calls[3][0]).toEqual(original);
  expect(mockRelease).not.toHaveBeenCalled();
});
