/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import TodayControls from "../TodayControls";
import type { BoardLinks } from "@/app/dashboard/today/today-board-data";
import { I18nProvider } from "@/i18n";
jest.mock("@/components/ui/use-display-locale", () => ({
  useDisplayLocale: () => "en-CA",
}));
const links: BoardLinks = {
  calendar: "/dashboard/calendar",
  chores: "/dashboard/chores",
  meals: "/dashboard/meals",
  lists: "/dashboard/lists/groceries",
  features: "/dashboard/features",
};
const refresh = jest.fn();
function mount(role = "parent", online = true, choices = links) {
  return render(
    <TodayControls
      role={role}
      links={choices}
      onRefresh={refresh}
      online={online}
    />,
  );
}
function openQuickAdd(label = "Add or ask") {
  fireEvent.click(screen.getByRole("button", { name: label }));
}
function disclosure(label = "Today controls") {
  return screen
    .getByText(label, { selector: "summary" })
    .closest("details") as HTMLDetailsElement;
}
function openDisclosure(label: string) {
  const control = disclosure(label);
  control.open = true;
  fireEvent(control, new Event("toggle"));
  return control;
}
beforeEach(() => refresh.mockClear());
it.each(["parent", "teen"] as const)(
  "%s opens quick add without duplicating primary navigation",
  (role) => {
    mount(role);
    const dispatch = jest.spyOn(window, "dispatchEvent");
    openQuickAdd();
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: "herewoven:quick-add" }),
    );
    dispatch.mockRestore();
    openDisclosure("Today controls");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh now" })).toBeInTheDocument();
  },
);
it("does not offer event creation or parent-only actions to a child", () => {
  mount("child");
  expect(screen.queryByRole("button", { name: "Add or ask" })).toBeNull();
  expect(screen.queryByText("Add event")).not.toBeInTheDocument();
  expect(screen.queryByText("Add chore")).not.toBeInTheDocument();
  expect(screen.queryByText("Household features")).not.toBeInTheDocument();
});
it.each(["parent", "teen", "child"] as const)(
  "does not offer event creation when the calendar link is absent for %s",
  (role) => {
    mount(role, true, {
      calendar: null,
      chores: null,
      meals: null,
      lists: null,
      features: null,
    });
    expect(
      screen.queryByRole("link", { name: "Add event" }),
    ).not.toBeInTheDocument();
  },
);
it("respects absent feature links", () => {
  mount("parent", true, {
    calendar: "/dashboard/calendar",
    chores: null,
    meals: null,
    lists: null,
    features: null,
  });
  expect(
    screen.queryByRole("link", { name: "Groceries" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "Plan meals" }),
  ).not.toBeInTheDocument();
});
it("uses the typed Today dictionary for Spanish controls", () => {
  render(
    <I18nProvider locale="es">
      <TodayControls role="parent" links={links} onRefresh={refresh} online />
    </I18nProvider>,
  );
  expect(
    screen.getByRole("navigation", { name: "Acciones rápidas de hoy" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Añadir o preguntar" }),
  ).toBeInTheDocument();
  openDisclosure("Controles de hoy");
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Actualizar ahora" }),
  ).toBeInTheDocument();
});
it("refreshes, closes the disclosure and returns focus", () => {
  mount();
  const details = disclosure();
  details.open = true;
  fireEvent.click(screen.getByRole("button", { name: "Refresh now" }));
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(details.open).toBe(false);
  expect(details.querySelector("summary")).toHaveFocus();
});
it("disables refresh offline", () => {
  mount("parent", false);
  openDisclosure("Today controls");
  expect(screen.getByRole("button", { name: "Refresh now" })).toBeDisabled();
  expect(screen.getByText("Reconnect to refresh.")).toBeInTheDocument();
});
it("dismisses on Escape and outside pointer", () => {
  mount();
  const details = disclosure();
  details.open = true;
  fireEvent.keyDown(screen.getByRole("button", { name: "Refresh now" }), {
    key: "Escape",
  });
  expect(details.open).toBe(false);
  expect(details.querySelector("summary")).toHaveFocus();
  details.open = true;
  fireEvent.pointerDown(document.body);
  expect(details.open).toBe(false);
});

it("leaves an open child dialog in charge of Escape", () => {
  render(
    <TodayControls role="parent" links={links} onRefresh={refresh} online>
      <div role="dialog" aria-label="Customize Today">
        <button type="button">Child action</button>
      </div>
    </TodayControls>,
  );
  const details = openDisclosure("Today controls");
  const child = screen.getByRole("button", { name: "Child action" });
  child.focus();
  fireEvent.keyDown(child, { key: "Escape" });
  expect(details.open).toBe(true);
  expect(child).toHaveFocus();
});
