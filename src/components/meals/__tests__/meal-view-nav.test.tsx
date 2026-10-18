/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { render, screen, within } from "@testing-library/react";
import { I18nProvider } from "@/i18n";
import { MealViewNav } from "../MealViewNav";

jest.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(
    {},
    "",
    "/dashboard/meals?start=2026-03-08&view=bulk&keep=one%26two",
  );
});

it.each(["plan", "explore", "prep"] as const)(
  "keeps week context and one current destination from %s",
  (active) => {
    render(
      <I18nProvider locale="en">
        <MealViewNav active={active} />
      </I18nProvider>,
    );
    const nav = screen.getByRole("navigation", { name: "Meal planning views" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "Plan",
      "Explore",
      "Prep",
    ]);
    expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(links[["plan", "explore", "prep"].indexOf(active)]).toHaveAttribute(
      "aria-current",
      "page",
    );
    for (const [index, link] of links.entries()) {
      const url = new URL(link.getAttribute("href")!, window.location.origin);
      expect(url.pathname).toBe(
        index === 1 ? "/dashboard/meals/explore" : "/dashboard/meals",
      );
      expect(url.searchParams.get("start")).toBe("2026-03-08");
      expect(url.searchParams.get("keep")).toBe("one&two");
      expect(url.searchParams.get("view")).toBe(index === 2 ? "bulk" : null);
    }
  },
);

it("uses localized route links without inventing a selected week", () => {
  window.history.replaceState({}, "", "/dashboard/meals/explore");
  render(
    <I18nProvider locale="es">
      <MealViewNav active="explore" />
    </I18nProvider>,
  );
  const nav = screen.getByRole("navigation", {
    name: "Vistas de planificación",
  });
  expect(
    within(nav).getByRole("link", { name: "Plan" }),
  ).toHaveAttribute("href", "/dashboard/meals");
  expect(within(nav).getByRole("link", { name: "Explorar" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(within(nav).getByRole("link", { name: "Preparar" })).toHaveAttribute(
    "href",
    "/dashboard/meals?view=bulk",
  );
});
