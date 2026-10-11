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

it("summarizes selected weekdays and the next occurrence in English", () => {
  render(
    <I18nProvider locale="en">
      <WeeklyDaysPicker days={[4, 1]} onChange={jest.fn()} />
    </I18nProvider>,
  );

  expect(screen.getByTestId("weekly-schedule-summary").textContent).toBe(
    "Every Monday, Thursday · next Oct 12",
  );
});

it("uses the Spanish weekday and date labels", () => {
  render(
    <I18nProvider locale="es">
      <WeeklyDaysPicker days={[4, 1]} onChange={jest.fn()} />
    </I18nProvider>,
  );

  expect(screen.getByTestId("weekly-schedule-summary").textContent).toBe(
    "Cada lunes, jueves · próxima 12 oct",
  );
});

it("does not show a schedule result before a weekday is selected", () => {
  render(
    <I18nProvider>
      <WeeklyDaysPicker days={[]} onChange={jest.fn()} />
    </I18nProvider>,
  );

  expect(screen.queryByTestId("weekly-schedule-summary")).toBeNull();
});
