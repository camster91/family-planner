/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "@/i18n";
const back = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ back }) }));
// These cases own the wrapper copy and busy contract. Existing actual-form
// journey source owns submissions, uploads, optional fields and permissions.
jest.mock("@/app/dashboard/chores/create/CreateChoreForm", () => ({
  __esModule: true,
  default: ({
    inSheet,
    onBusyChange,
  }: {
    inSheet?: boolean;
    onBusyChange?: (busy: boolean) => void;
  }) => (
    <div data-testid="canonical-create-form" data-sheet={String(inSheet)}>
      <button onClick={() => onBusyChange?.(true)}>Begin save</button>
      <button onClick={() => onBusyChange?.(false)}>Finish save</button>
    </div>
  ),
}));
jest.mock("@/app/dashboard/chores/edit/EditChoreForm", () => ({
  __esModule: true,
  default: ({
    inSheet,
    onBusyChange,
  }: {
    inSheet?: boolean;
    onBusyChange?: (busy: boolean) => void;
  }) => (
    <div data-testid="canonical-edit-form" data-sheet={String(inSheet)}>
      <button onClick={() => onBusyChange?.(true)}>Begin save</button>
      <button onClick={() => onBusyChange?.(false)}>Finish save</button>
    </div>
  ),
}));
import { ChoreCreateSheet, ChoreEditSheet } from "../DashboardFormSheets";

beforeEach(async () => {
  await waitFor(() =>
    expect(window.history.state?.__herewovenPendingForm).toBeUndefined(),
  );
  back.mockReset();
});
it.each([
  ["create", ChoreCreateSheet, "Nueva tarea"],
  ["edit", ChoreEditSheet, "Editar tarea"],
] as const)(
  "localizes the %s shell and preserves busy dismissal around its canonical form",
  async (kind, Sheet, title) => {
    render(
      <I18nProvider locale="es">
        <Sheet />
      </I18nProvider>,
    );
    expect(screen.getByRole("dialog", { name: title })).toHaveAttribute(
      "aria-modal",
      "true",
    );
    expect(
      screen.getByRole("button", { name: "Cerrar y volver" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Cierra para volver. Se borrarán los cambios sin guardar.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId(`canonical-${kind}-form`)).toHaveAttribute(
      "data-sheet",
      "true",
    );
    fireEvent.click(screen.getByText("Begin save"));
    expect(
      screen.getByText("Espera a que termine de guardar o subir la foto."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Cerrar y volver" }),
    ).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(back).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Finish save"));
    expect(
      screen.getByRole("button", { name: "Cerrar y volver" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(window.history.state?.__herewovenPendingForm).toBeUndefined(),
    );
  },
);
it("retains English copy when no Spanish locale is selected", () => {
  render(
    <I18nProvider locale="en">
      <ChoreCreateSheet />
    </I18nProvider>,
  );
  expect(screen.getByRole("dialog", { name: "New Chore" })).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Close and return" }),
  ).toBeInTheDocument();
});
