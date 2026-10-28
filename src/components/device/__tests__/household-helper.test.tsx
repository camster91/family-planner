/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import DeviceHouseholdHelper from "../DeviceHouseholdHelper";
import type { TodayBoardData } from "@/app/dashboard/today/today-board-data";
const board: TodayBoardData = {
  generatedAt: "2026-10-27T12:00:00Z",
  members: [],
  events: [],
  chores: [],
  dinners: null,
  shopping: {
    items: [
      {
        id: "one",
        content: "Milk",
        quantity: 2,
        listId: "list",
        listName: "Groceries",
      },
    ],
    total: 6,
  },
  links: {
    calendar: null,
    chores: null,
    meals: null,
    lists: null,
    features: null,
  },
};
it("shows only shared snapshot answers and explains cached data", () => {
  render(<DeviceHouseholdHelper data={board} cached active />);
  fireEvent.click(screen.getByRole("button", { name: "Household helper" }));
  expect(screen.getByText(/Showing a saved plan/)).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: "What do we need to buy?" }),
  );
  expect(screen.getByText("Milk × 2")).toBeVisible();
  expect(
    screen.getByText("This preview does not show every item."),
  ).toBeVisible();
  expect(screen.getByRole("textbox")).toHaveValue("");
  expect(screen.queryByRole("link")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "What’s for dinner?" }));
  expect(screen.getByText("This section is turned off.")).toBeVisible();
});
it("discards the question on cover/elevation and does not reopen on wake", () => {
  const { rerender } = render(
    <DeviceHouseholdHelper data={board} cached={false} active />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Household helper" }));
  fireEvent.click(
    screen.getByRole("button", { name: "What do we need to buy?" }),
  );
  rerender(
    <DeviceHouseholdHelper data={board} cached={false} active={false} />,
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  rerender(<DeviceHouseholdHelper data={board} cached={false} active />);
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Household helper" }));
  expect(screen.queryByText("Milk × 2")).toBeNull();
});
it("drops open answers on page hide", () => {
  render(<DeviceHouseholdHelper data={board} cached={false} active />);
  fireEvent.click(screen.getByRole("button", { name: "Household helper" }));
  fireEvent(window, new Event("pagehide"));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("answers a supported question locally and clears the answer for an unsupported request", () => {
  render(<DeviceHouseholdHelper data={board} cached={false} active />);
  fireEvent.click(screen.getByRole("button", { name: "Household helper" }));
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value: "What do we need to buy?" } });
  fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
  expect(screen.getByText("Milk × 2")).toBeVisible();
  fireEvent.change(input, { target: { value: "delete groceries" } });
  fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
  expect(screen.getByText(/Try one of the questions below/)).toBeVisible();
  expect(screen.queryByText("Milk × 2")).toBeNull();
  fireEvent(window, new Event("pagehide"));
  fireEvent.click(screen.getByRole("button", { name: "Household helper" }));
  expect(screen.getByRole("textbox")).toHaveValue("");
});
