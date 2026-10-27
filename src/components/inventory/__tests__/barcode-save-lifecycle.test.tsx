/** @jest-environment jsdom */
// Source authored UNRUN. Fabricated rows, mocked canonical transport only.
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "@/i18n";
import { BarcodeFoodDialog } from "../BarcodeFoodDialog";
const mockIntake = jest.fn();
const mockStop = jest.fn();
const mockVideo = { current: null };
const mockRelease = jest.fn(async () => true);
jest.mock("../InventoryRecovery", () => ({ useInventoryWrites: () => ({ intake: mockIntake }) }));
jest.mock("../use-food-barcode-camera", () => ({ useFoodBarcodeCamera: () => ({ video: mockVideo, active: false, error: null, start: jest.fn(), stop: mockStop }) }));
jest.mock("@/components/layout/pending-form-navigation", () => ({ usePendingFormNavigationController: () => ({ releaseBeforeNavigation: mockRelease }) }));
const context = { userId: "fixture-person", familyId: "fixture-family" };
const originalFetch = global.fetch;
beforeEach(() => {
  mockIntake.mockReset(); mockRelease.mockClear();
  global.fetch = jest.fn(async (path: string) => ({ ok: true, status: 200, json: async () => ({ context, barcode: new URL(path, "https://fixture.invalid").searchParams.get("barcode"), product: null, publicLookupAvailable: false }) })) as unknown as typeof fetch;
});
afterEach(() => { global.fetch = originalFetch; });
async function add(code: string, name: string) {
  if (!screen.queryByLabelText("Printed barcode")) fireEvent.click(screen.getByRole("button", { name: "Add codes" }));
  fireEvent.change(screen.getByLabelText("Printed barcode"), { target: { value: code } });
  fireEvent.click(screen.getByRole("button", { name: "Add code to review" }));
  await waitFor(() => expect(screen.getByLabelText("Food name")).toBeEnabled());
  fireEvent.change(screen.getByLabelText("Food name"), { target: { value: name } });
}
it("stops after a suspended send and reuses its exact request on deliberate retry", async () => {
  let finish!: (value: unknown) => void;
  mockIntake.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  mockIntake.mockResolvedValue({ kind: "confirmed", itemId: "fixture-stock" });
  const done = jest.fn();
  const props = { initialContext: context, onClose: jest.fn(), onDone: done };
  const view = render(<I18nProvider locale="en"><BarcodeFoodDialog {...props} /></I18nProvider>);
  await add("036000291452", "First beans");
  await add("4006381333931", "Second beans");
  fireEvent.click(screen.getByRole("button", { name: "Save selected reviewed items" }));
  expect(mockIntake).toHaveBeenCalledTimes(1);
  const original = { ...mockIntake.mock.calls[0][0] };
  view.rerender(<I18nProvider locale="en"><BarcodeFoodDialog {...props} suspended /></I18nProvider>);
  view.rerender(<I18nProvider locale="en"><BarcodeFoodDialog {...props} /></I18nProvider>);
  await act(async () => { finish({ kind: "confirmed", itemId: "late-stock" }); });
  expect(mockIntake).toHaveBeenCalledTimes(1);
  expect(done).not.toHaveBeenCalled();
  expect(mockRelease).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Check the same saves" }));
  await waitFor(() => expect(mockIntake).toHaveBeenCalledTimes(3));
  expect(mockIntake.mock.calls[1][0]).toEqual(original);
  await waitFor(() => expect(done).toHaveBeenCalledWith(2));
});
it("does not send the next row after an access refusal", async () => {
  mockIntake.mockResolvedValue({ kind: "refused", code: "AUTH_CHANGED", accessChanged: true });
  const verify = jest.fn();
  render(<I18nProvider locale="en"><BarcodeFoodDialog initialContext={context} onClose={jest.fn()} onDone={jest.fn()} onVerifyAccess={verify} /></I18nProvider>);
  await add("036000291452", "First beans"); await add("4006381333931", "Second beans");
  fireEvent.click(screen.getByRole("button", { name: "Save selected reviewed items" }));
  await waitFor(() => expect(verify).toHaveBeenCalledTimes(1));
  expect(mockIntake).toHaveBeenCalledTimes(1);
});
it("keeps uncertainty and original request after a thrown send followed by a product conflict", async () => {
  mockIntake.mockRejectedValueOnce(new Error("Fixture lost response"));
  mockIntake.mockResolvedValue({ kind: "refused", code: "PRODUCT_CHANGED" });
  render(<I18nProvider locale="en"><BarcodeFoodDialog initialContext={context} onClose={jest.fn()} onDone={jest.fn()} /></I18nProvider>);
  await add("036000291452", "First beans");
  fireEvent.click(screen.getByRole("button", { name: "Save selected reviewed items" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Check the same saves" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Check the same saves" }));
  await waitFor(() => expect(mockIntake).toHaveBeenCalledTimes(2));
  expect(mockIntake.mock.calls[1][0]).toEqual(mockIntake.mock.calls[0][0]);
  expect(screen.getByLabelText("Food name")).toBeDisabled();
  expect(mockRelease).not.toHaveBeenCalled();
});
