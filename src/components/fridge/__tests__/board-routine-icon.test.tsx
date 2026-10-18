/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import * as React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChoreRow } from "../regions";

let mockPictureFails = false;
jest.mock("@/components/chores/RoutineIcon", () => ({
  RoutineIcon: ({ icon, className }: { icon: string; className: string }) => {
    if (mockPictureFails) throw new Error("Optional picture unavailable");
    return (
      <svg
        data-testid="loaded-picture"
        data-icon={icon}
        className={className}
        aria-hidden="true"
      />
    );
  },
}));

const chore = {
  id: "chore",
  title: "Brush teeth",
  status: "pending",
  dueDay: "2026-01-05",
  assigneeId: "child",
};

it("loads the optional picture without changing the labelled chore action", async () => {
  const tick = jest.fn();
  render(
    <ul>
      <ChoreRow
        chore={{ ...chore, icon: "brush-teeth" }}
        name="Casey"
        onTick={tick}
      />
    </ul>,
  );
  expect(await screen.findByTestId("loaded-picture")).toHaveAttribute(
    "data-icon",
    "brush-teeth",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Mark Brush teeth done, Casey" }),
  );
  expect(tick).toHaveBeenCalledWith({ ...chore, icon: "brush-teeth" });
});

it("keeps completion available if the decorative picture fails", async () => {
  mockPictureFails = true;
  const error = jest.spyOn(console, "error").mockImplementation(() => {});
  const tick = jest.fn();
  try {
    render(
      <ul>
        <ChoreRow
          chore={{ ...chore, icon: "brush-teeth" }}
          name="Casey"
          onTick={tick}
        />
      </ul>,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Mark Brush teeth done, Casey" }),
    );
    expect(tick).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("loaded-picture")).not.toBeInTheDocument();
  } finally {
    mockPictureFails = false;
    error.mockRestore();
  }
});
