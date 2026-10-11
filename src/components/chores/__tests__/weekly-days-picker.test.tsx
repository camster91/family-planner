/** @jest-environment jsdom */
import * as React from "react";
import { render, screen } from "@testing-library/react";
import { I18nProvider } from "@/i18n";
import { WeeklyDaysPicker } from "../WeeklyDaysPicker";

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 9, 12, 12));
});

afterEach(() => {
  jest.useRealTimers();
});

it("summarizes selected weekdays without inventing a canonical next date", () => {
  render(
    <I18nProvider locale="en">
      <WeeklyDaysPicker days={[4, 1]} onChange={jest.fn()} />
    </I18nProvider>,
  );

  expect(screen.getByTestId("weekly-schedule-summary").textContent).toBe(
    "Every Monday, Thursday",
  );
});

it("uses the Spanish picker and weekday labels", () => {
  render(
    <I18nProvider locale="es">
      <WeeklyDaysPicker days={[4, 1]} onChange={jest.fn()} />
    </I18nProvider>,
  );

  expect(screen.getByTestId("weekly-schedule-summary").textContent).toBe(
    "Cada lunes, jueves",
  );
  expect(screen.getByText("Repetir los")).toBeTruthy();
  expect(screen.getByText("Elige uno o más días de cada semana.")).toBeTruthy();
  expect(screen.getByRole("checkbox", { name: "Lunes" })).toBeTruthy();
});

it("does not show a schedule result before a weekday is selected", () => {
  render(
    <I18nProvider>
      <WeeklyDaysPicker days={[]} onChange={jest.fn()} />
    </I18nProvider>,
  );

  expect(screen.queryByTestId("weekly-schedule-summary")).toBeNull();
});

it("honors explicit copy overrides for the picker chrome and day labels", () => {
  render(
    <I18nProvider locale="es">
      <WeeklyDaysPicker
        days={[1]}
        onChange={jest.fn()}
        copy={{
          legend: "Custom repeat",
          hint: "Pick a day",
          weekdays: { 1: "Monday override" },
        }}
      />
    </I18nProvider>,
  );

  expect(screen.getByText("Custom repeat")).toBeTruthy();
  expect(screen.getByText("Pick a day")).toBeTruthy();
  expect(screen.getByText("Monday override")).toBeTruthy();
});
