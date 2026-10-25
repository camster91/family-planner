/** @jest-environment jsdom */
/** Authored/unrun. Discovery links never imply a save or completed weekly step. */
import { fireEvent, render, screen } from "@testing-library/react";
import { FoodPlanningAccess } from "../FoodPlanningAccess";
import { MealPlanningReviewLinks } from "../MealPlanningReviewLinks";
const mockPush = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));
afterEach(() => jest.clearAllMocks());
it("omits personal recovery links for children", () => {
  render(
    <FoodPlanningAccess enabled role="child">
      <MealPlanningReviewLinks disabled={false} canNavigate={() => true} />
    </FoodPlanningAccess>,
  );
  expect(screen.queryByText("Planning and saved work")).not.toBeInTheDocument();
});
it("keeps personal recovery available during planning pause without advertising a new plan", () => {
  render(
    <FoodPlanningAccess enabled={false} role="teen">
      <MealPlanningReviewLinks disabled={false} canNavigate={() => true} />
    </FoodPlanningAccess>,
  );
  fireEvent.click(screen.getByText("Planning and saved work"));
  expect(
    screen.getByRole("link", { name: "Saved bulk cooking work" }),
  ).toHaveAttribute("href", "/dashboard/meals?view=bulk&bulkWork=recovery");
  expect(
    screen.queryByRole("link", { name: "Plan meals and prep" }),
  ).not.toBeInTheDocument();
  expect(mockPush).not.toHaveBeenCalled();
});
it("checks current weekly pending state before navigating and never marks progress", () => {
  let allowed = false;
  render(
    <FoodPlanningAccess enabled role="parent">
      <MealPlanningReviewLinks disabled={false} canNavigate={() => allowed} />
    </FoodPlanningAccess>,
  );
  fireEvent.click(screen.getByText("Planning and saved work"));
  fireEvent.click(screen.getByRole("link", { name: "Plan meals and prep" }));
  expect(mockPush).not.toHaveBeenCalled();
  allowed = true;
  fireEvent.click(screen.getByRole("link", { name: "Plan meals and prep" }));
  expect(mockPush).toHaveBeenCalledWith("/dashboard/meals?foodPlan=new");
});
