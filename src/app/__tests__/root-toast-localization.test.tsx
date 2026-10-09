/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  within,
  cleanup,
} from "@testing-library/react";
import RootLayout from "../layout";
import { useTranslation } from "@/i18n";
import { useUndoToast } from "@/components/ui/toast";
import { InventoryText } from "@/app/dashboard/inventory/inventory-copy";
import { inventoryFeedback } from "@/i18n/inventory";
import { pseudolocalizeTemplate } from "@/i18n/pseudo";

jest.mock("next/font/local", () => ({
  __esModule: true,
  default: () => ({ variable: "fixture-font" }),
}));
jest.mock("../globals.css", () => ({}));
jest.mock("@/components/providers/posthog-provider", () => ({
  PostHogProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
jest.mock("@/components/providers/theme-provider", () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
jest.mock("@/components/providers/csrf-fetch-patch", () => ({
  CsrfFetchPatch: () => null,
}));
jest.mock("@/components/providers/service-worker-registration", () => ({
  ServiceWorkerRegistration: () => null,
}));
jest.mock("@/components/ui/site-offline-banner", () => ({
  SiteOfflineBanner: () => null,
}));

const undo = jest.fn();
const privateName = "Synthetic {name} 李";
function Harness() {
  const { setLocale } = useTranslation();
  const show = useUndoToast();
  return (
    <>
      <button onClick={() => setLocale("es")}>Set Spanish</button>
      <button
        onClick={() =>
          show({
            title: (
              <InventoryText
                feedback={inventoryFeedback("usedName", { name: privateName })}
              />
            ),
            onUndo: undo,
          })
        }
      >
        Show synthetic undo
      </button>
    </>
  );
}
const oldPseudo = process.env.I18N_PSEUDO_ENABLED;
const oldGallery = process.env.DESIGN_GALLERY_ENABLED;
afterEach(() => {
  cleanup();
  jest.useRealTimers();
  localStorage.clear();
  undo.mockClear();
  if (oldPseudo === undefined) delete process.env.I18N_PSEUDO_ENABLED;
  else process.env.I18N_PSEUDO_ENABLED = oldPseudo;
  if (oldGallery === undefined) delete process.env.DESIGN_GALLERY_ENABLED;
  else process.env.DESIGN_GALLERY_ENABLED = oldGallery;
});
it.each([false, true])(
  "actual root provider wiring localizes a visible undo without resetting its timer: expanded=%s",
  (expanded) => {
    jest.useFakeTimers();
    process.env.I18N_PSEUDO_ENABLED = expanded ? "1" : "0";
    process.env.DESIGN_GALLERY_ENABLED = expanded ? "1" : "0";
    const root = RootLayout({ children: <Harness /> });
    const body = React.Children.toArray(root.props.children).find(
      (child) => React.isValidElement(child) && child.type === "body",
    ) as React.ReactElement<{ children: React.ReactNode }>;
    render(<>{body.props.children}</>);
    fireEvent.click(
      screen.getByRole("button", { name: "Show synthetic undo" }),
    );
    act(() => {
      jest.advanceTimersByTime(3000);
    });
    fireEvent.click(screen.getByRole("button", { name: "Set Spanish" }));
    const toast = screen.getByTestId("undo-toast");
    const translate = (text: string) =>
      expanded ? pseudolocalizeTemplate(text) : text;
    expect(toast).toHaveTextContent(
      translate("Usaste {name}").replace("{name}", privateName),
    );
    expect(
      within(toast).getByRole("button", {
        name: translate("Deshacer"),
      }),
    ).toBeInTheDocument();
    expect(
      within(toast).getByRole("button", {
        name: translate("Descartar aviso"),
      }),
    ).toBeInTheDocument();
    act(() => {
      jest.advanceTimersByTime(4999);
    });
    expect(toast).toBeInTheDocument();
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(screen.queryByTestId("undo-toast")).not.toBeInTheDocument();
    expect(undo).not.toHaveBeenCalled();
  },
);
