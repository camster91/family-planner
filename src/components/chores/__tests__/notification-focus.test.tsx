/** @jest-environment jsdom */
// Authored UNRUN. Read-only localized context, no action/API execution.
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { ChoreNotificationFocus } from "../ChoreNotificationFocus";
import { I18nProvider } from "@/i18n";
const target = { id: "fixture-chore", title: "Fixture task", description: "Steps kept in disclosure", dueDate: "2026-10-25T00:00:00.000Z", status: "pending" as const, canComplete: true };
it("focuses the exact read context with parent edit and a safe chores fallback", () => {
  render(<I18nProvider locale="en"><ChoreNotificationFocus target={target} canEdit /></I18nProvider>);
  expect(screen.getByRole("region", { name: "From notification" })).toHaveFocus();
  expect(screen.getByRole("link", { name: "Edit" })).toHaveAttribute("href", "/dashboard/chores/edit?id=fixture-chore");
  expect(screen.getByText("Details").closest("details")).not.toHaveAttribute("open");
});
it("keeps missing targets neutral and excludes parent edit for child views", () => {
  const view = render(<I18nProvider locale="es"><ChoreNotificationFocus target={null} canEdit={false} /></I18nProvider>);
  expect(screen.getByRole("status")).toHaveTextContent("Esta tarea no está disponible");
  expect(screen.getByRole("link", { name: "Abrir tareas" })).toHaveAttribute("href", "/dashboard/chores");
  view.rerender(<I18nProvider locale="es"><ChoreNotificationFocus target={target} canEdit={false} /></I18nProvider>);
  expect(screen.queryByRole("link", { name: "Editar" })).not.toBeInTheDocument();
});


it("hands off only explicit supported completion to the existing parent callback", () => {
  const done = jest.fn(async () => undefined);
  const view = render(<I18nProvider locale="en"><ChoreNotificationFocus target={target} canEdit={false} onComplete={done} /></I18nProvider>);
  screen.getByRole("button", { name: "Mark complete" }).click();
  expect(done).toHaveBeenCalledWith(target.id);
  view.rerender(<I18nProvider locale="en"><ChoreNotificationFocus target={target} canEdit={false} completing onComplete={done} /></I18nProvider>);
  expect(screen.getByRole("button", { name: "Marking done…" })).toBeDisabled();
  view.rerender(<I18nProvider locale="en"><ChoreNotificationFocus target={{ ...target, canComplete: false }} canEdit={false} onComplete={done} /></I18nProvider>);
  expect(screen.queryByRole("button", { name: "Mark complete" })).not.toBeInTheDocument();
});
