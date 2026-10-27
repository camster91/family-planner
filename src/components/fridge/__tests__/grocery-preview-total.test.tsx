/** @jest-environment jsdom */
// Authored for the deferred QA pass; no execution claimed.
import * as React from "react";
import { render, screen } from "@testing-library/react";
import { GroceriesRegion } from "../regions";

it("does not claim the household list is clear when only the loaded preview is empty", () => {
  render(<GroceriesRegion shopping={{ items: [], total: 3 }} listsHref="/dashboard/lists" />);
  expect(screen.queryByText("The grocery list is clear.")).toBeNull();
  expect(screen.getByText("3 to buy")).toBeTruthy();
  expect(screen.getByRole("link", { name: "3 more to buy" }).getAttribute("href"))
    .toBe("/dashboard/lists/groceries");
});
it("shows the clear state only when the canonical total is zero", () => {
  render(<GroceriesRegion shopping={{ items: [], total: 0 }} listsHref="/dashboard/lists" />);
  expect(screen.getByText("The grocery list is clear.")).toBeTruthy();
  expect(screen.queryByText("0 to buy")).toBeNull();
});
