/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { RecipeCookingView } from "../RecipeCookingView";
const recipe = {
  id: "fixture_recipe",
  title: "Soup",
  description: null,
  instructions: "Simmer 20 minutes.",
  servings: 4,
  prep_time: 5,
  cook_time: 20,
  ingredients: [
    {
      id: "fixture_line",
      amount: 2,
      unit: "cups",
      note: "drained",
      ingredient: { id: "fixture_ingredient", name: "Beans", unit: "cups" },
    },
  ],
};
it("scales reviewed ingredient amounts and grocery intent without mutating the saved recipe or directions", () => {
  const action = jest.fn((target) => (
    <span data-testid="grocery-portions">{target}</span>
  ));
  render(<RecipeCookingView recipe={recipe} actions={action} />);
  fireEvent.change(
    screen.getByRole("spinbutton", { name: "Cooking portions" }),
    { target: { value: "6" } },
  );
  expect(screen.getByText("3 cups")).toBeTruthy();
  expect(screen.getByText("Simmer 20 minutes.")).toBeTruthy();
  expect(screen.getByTestId("grocery-portions").textContent).toBe("6");
  expect(recipe.ingredients[0].amount).toBe(2);
  expect(recipe.servings).toBe(4);
  fireEvent.click(screen.getByRole("button", { name: "Original · 4" }));
  expect(screen.getByText("2 cups")).toBeTruthy();
});
it("shows original amounts on invalid input and never invents unknown base servings", () => {
  const view = render(<RecipeCookingView recipe={recipe} />);
  fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "0" } });
  expect(screen.getByRole("spinbutton")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  expect(screen.getByText("2 cups")).toBeTruthy();
  view.rerender(
    <RecipeCookingView key="unknown" recipe={{ ...recipe, servings: null }} />,
  );
  expect(screen.queryByRole("spinbutton")).toBeNull();
  expect(screen.getByText("2 cups")).toBeTruthy();
});
