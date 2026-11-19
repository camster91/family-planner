/**
 * @jest-environment jsdom
 */
// A /dashboard page that calls notFound() (for example a feature switched off
// by a server flag: /dashboard/chores/schedules, /dashboard/budget/imported)
// renders this inside the dashboard layout, so the app frame stays and the
// page says plainly that it is not available, with a way Home.
import * as React from "react";
import { render, screen } from "@testing-library/react";
import { I18nProvider } from "@/i18n";
import DashboardNotFound from "../not-found";

describe("dashboard not-found page", () => {
  it("says the page is not available and links Home (44px target)", async () => {
    render(<DashboardNotFound />);
    // The body loads on demand so it stays out of every page's initial JS.
    expect(
      await screen.findByRole("heading", { level: 1, name: "This page isn't available" }),
    ).toBeTruthy();
    const home = screen.getByRole("link", { name: "Go to Home" });
    expect(home.getAttribute("href")).toBe("/dashboard");
    expect(home.className).toContain("min-h-[44px]");
    expect(screen.queryByText(/404|could not be found/i)).toBeNull();
  });

  it("speaks Spanish too", async () => {
    render(
      <I18nProvider locale="es">
        <DashboardNotFound />
      </I18nProvider>,
    );
    expect(
      await screen.findByRole("heading", { level: 1, name: "Esta página no está disponible" }),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ir a Inicio" })).toBeTruthy();
  });
});
