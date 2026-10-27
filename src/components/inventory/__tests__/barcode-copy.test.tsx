/** @jest-environment jsdom */
// Authored/unrun: semantic feedback rerenders without scan/save side effects.
import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider, useTranslation } from "@/i18n";
import { BarcodeFoodDialog } from "../BarcodeFoodDialog";
const mockIntake = jest.fn();
const mockStart = jest.fn();
const mockStop = jest.fn();
const mockVideo = { current: null };
jest.mock("../InventoryRecovery", () => ({ useInventoryWrites: () => ({ intake: mockIntake }) }));
jest.mock("../use-food-barcode-camera", () => ({ useFoodBarcodeCamera: () => ({ video: mockVideo, active: false, error: null, start: mockStart, stop: mockStop }) }));
function Language() {
  const { setLocale } = useTranslation();
  return <button onClick={() => setLocale("es")}>Spanish copy</button>;
}
it("keeps typed barcode and translates existing validation feedback without another action", () => {
  global.fetch = jest.fn();
  render(<I18nProvider locale="en"><Language /><BarcodeFoodDialog
    initialContext={{ userId: "fixture-person", familyId: "fixture-family" }}
    onClose={() => undefined} onDone={() => undefined}
  /></I18nProvider>);
  const input = screen.getByLabelText("Printed barcode");
  fireEvent.change(input, { target: { value: "123" } });
  fireEvent.click(screen.getByRole("button", { name: "Add code to review" }));
  expect(screen.getByText(/Check every digit and format/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Spanish copy" }));
  expect(screen.getByText(/Revisa los dígitos y el formato/)).toBeInTheDocument();
  expect(screen.getByLabelText("Código impreso")).toBe(input);
  expect(input).toHaveValue("123");
  expect(fetch).not.toHaveBeenCalled();
  expect(mockIntake).not.toHaveBeenCalled();
  expect(mockStart).not.toHaveBeenCalled();
});
