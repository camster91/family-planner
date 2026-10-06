/** @jest-environment jsdom */
import * as React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import CalendarPageClient, { calendarMonthHref } from "../CalendarPageClient";
jest.mock("../CalendarPlanner", () => ({
  CalendarPlanner: ({
    initialDate,
    chooseLocalToday,
  }: {
    initialDate: string;
    chooseLocalToday: boolean;
  }) => (
    <div data-testid="planner" data-today={String(chooseLocalToday)}>
      {initialDate}
    </div>
  ),
}));
const mockRefresh = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));
jest.mock("@/components/capture/CaptureBox", () => ({
  CaptureBox: ({ onSaved }: { onSaved: () => void }) => (
    <button onClick={onSaved}>capture save</button>
  ),
}));
it("keeps the exported legacy month URL exactly", () => {
  expect(calendarMonthHref(2026, 1)).toBe(
    "/dashboard/calendar?year=2026&month=1",
  );
  expect(calendarMonthHref(2025, 12)).toBe(
    "/dashboard/calendar?year=2025&month=12",
  );
});
it("anchors legacy month URLs to their first day; implicit URLs choose viewer today", () => {
  const { rerender } = render(
    <CalendarPageClient events={[]} currentMonth={1} currentYear={2026} />,
  );
  expect(screen.getByTestId("planner").textContent).toBe("2026-01-01");
  expect(screen.getByTestId("planner").getAttribute("data-today")).toBe(
    "false",
  );
  rerender(
    <CalendarPageClient
      events={[]}
      currentMonth={1}
      currentYear={2026}
      monthFromUrl={false}
    />,
  );
  expect(screen.getByTestId("planner").getAttribute("data-today")).toBe("true");
});
it("refreshes the canonical calendar after quick capture saves", () => {
  render(
    <CalendarPageClient events={[]} currentMonth={1} currentYear={2026} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "capture save" }));
  expect(mockRefresh).toHaveBeenCalled();
});
