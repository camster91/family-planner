/** @jest-environment jsdom */
import * as React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { I18nProvider, useTranslation } from "@/i18n";
import { GROCERY_SECTIONS } from "@/lib/grocery-sections";
import { storeSectionsSpanish } from "@/i18n/store-sections";
import { MoveToSectionDialog } from "../MoveToSectionDialog";

function LocaleToggle() {
  const { setLocale } = useTranslation();
  return <button onClick={() => setLocale("es")}>Change locale</button>;
}
it("retains pending/error/household text during a locale switch and returns every original section ID or null", () => {
  const pick = jest.fn();
  const close = jest.fn();
  const target = {
    itemId: "fixture",
    content: "Apples {current} 🍎",
    current: "pantry" as const,
    chosen: true,
  };
  const view = (pending: boolean) => (
    <I18nProvider>
      <LocaleToggle />
      <MoveToSectionDialog
        target={target}
        pending={pending}
        error="Fixture server text {current}"
        onPick={pick}
        onClose={close}
      />
    </I18nProvider>
  );
  const { rerender } = render(view(true));
  const original = screen.getByRole("dialog", {
    name: `Move “${target.content}”`,
  });
  fireEvent.click(screen.getByRole("button", { name: "Change locale" }));
  const dialog = screen.getByRole("dialog", {
    name: `Mover “${target.content}”`,
  });
  expect(dialog).toBe(original);
  expect(within(dialog).getByRole("alert").textContent).toBe(
    "Fixture server text {current}",
  );
  expect(
    within(dialog).getByRole("button", { name: /Despensa/, pressed: true })
      .textContent,
  ).toContain("Actual");
  expect(within(dialog).queryByRole("button", { name: "Cerrar" })).toBeNull();
  for (const button of within(dialog).getAllByRole("button")) {
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
  }
  expect(pick).not.toHaveBeenCalled();
  rerender(view(false));
  for (const id of GROCERY_SECTIONS) {
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: id === "pantry" ? /Despensa/ : storeSectionsSpanish[id],
        pressed: id === "pantry",
      }),
    );
  }
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Usar la sección automática" }),
  );
  expect(pick.mock.calls.map((call) => call[0])).toEqual([
    ...GROCERY_SECTIONS,
    null,
  ]);
  fireEvent.click(within(dialog).getByRole("button", { name: "Cerrar" }));
  expect(close).toHaveBeenCalledTimes(1);
});
