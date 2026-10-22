/** @jest-environment jsdom */
/** Authored/unrun. Source rendering assertions; real browser/device QA is later. */
import { render, screen, fireEvent } from "@testing-library/react";
import { FoodPlanSummary } from "../FoodPlanSummary";
import { makePreview } from "@/lib/food-planning/__tests__/view-fixture";
jest.mock("@/i18n", () => ({ useTranslation: () => ({ locale: "en" }) }));
it("does not turn scaled unknown duration into a known cooking estimate or expose save controls", () => {
  const plan = makePreview().plan;
  plan.slots[0].choice = {
    ...plan.slots[0].choice!,
    servings: 4,
    totalMinutes: null,
  };
  render(<FoodPlanSummary plan={plan} mode="meals" />);
  expect(
    screen.getByText(/Time for these servings is unknown/),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/scaling portions does not establish cooking time/),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /save|confirm/i }),
  ).not.toBeInTheDocument();
});
it("shows one choice at a time and paginates large ingredient detail lists", () => {
  const plan = makePreview().plan,
    first = plan.slots[0];
  plan.slots = [
    first,
    {
      ...first,
      key: "second",
      choice: {
        ...first.choice!,
        recipeId: "recipe-b",
        title: "Second recipe",
      },
    },
  ];
  plan.slots[0].choice = {
    ...first.choice!,
    ingredients: Array.from({ length: 8 }, (_, index) => ({
      ...first.choice!.ingredients[0],
      ingredientId: `ingredient-${index}`,
      name: `Ingredient ${index}`,
    })),
  };
  render(<FoodPlanSummary plan={plan} mode="meals" />);
  expect(screen.queryByText("Second recipe")).not.toBeInTheDocument();
  fireEvent.click(screen.getByText(/Ingredients and recorded stock/));
  expect(screen.queryByText("Ingredient 7")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Next records" }));
  expect(screen.getByText("Ingredient 7")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Next choice" }));
  expect(screen.getByText("Second recipe")).toBeInTheDocument();
});
it("keeps feasibility holds explicit and changing an alternative only emits a preview request callback", () => {
  const plan = makePreview().plan,
    choose = jest.fn();
  plan.slots[0].holds = ["calendar-unknown"];
  plan.slots[0].alternatives = [
    { ...plan.slots[0].choice!, recipeId: "recipe-b", title: "Another recipe" },
  ];
  render(<FoodPlanSummary plan={plan} mode="meals" onChooseRecipe={choose} />);
  expect(
    screen.getByText("Calendar availability could not be established."),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByText("Other recipes"));
  fireEvent.click(screen.getByRole("button", { name: "Another recipe" }));
  expect(choose).toHaveBeenCalledWith("dinner", "recipe-b");
});
it("explains unresolved source records and hands correction to canonical navigation without clearing holds", () => {
  const plan = makePreview().plan,
    open = jest.fn();
  plan.commitments.complete = false;
  plan.existingMealReservationsChecked = true;
  plan.commitments.entries = [
    {
      id: "synthetic-existing-meal",
      kind: "meal",
      date: "2026-10-22",
      originalDate: "2026-10-22",
      label: "Synthetic free-text meal",
      recipeId: null,
      servings: null,
      servingsBasis: "unknown",
      ingredients: [],
      holds: ["recipe-unknown"],
    },
  ];
  render(<FoodPlanSummary plan={plan} mode="meals" onOpenCommitment={open} />);
  fireEvent.click(screen.getByText(/Existing meal commitments/));
  fireEvent.click(screen.getByText("Why this needs review"));
  expect(
    screen.getByText(/This meal has no available saved recipe/),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/Unknown food needs are not treated as zero/),
  ).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Open Meals for this date" }),
  );
  expect(open).toHaveBeenCalledWith({ kind: "meal", date: "2026-10-22" });
  expect(plan.commitments.complete).toBe(false);
  expect(plan.commitments.entries[0].holds).toEqual(["recipe-unknown"]);
});
