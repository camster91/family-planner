/** @jest-environment jsdom */
/** Authored/unrun. Mounted source cases; final browser acceptance is deferred. */
import { render, screen, fireEvent } from "@testing-library/react";
import { FoodGroceryOutcomesView } from "../FoodGroceryOutcomes";
import {
  FOOD_GROCERY_OUTCOMES,
  type FoodGroceryOutcomes,
} from "@/lib/food-planning/grocery-outcomes-contract";
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock("@/i18n", () => ({ useTranslation: () => ({ locale: "en" }) }));
const outcome = (): FoodGroceryOutcomes => ({
  protocol: FOOD_GROCERY_OUTCOMES,
  ownerScope: "b".repeat(64),
  requestHash: "a".repeat(64),
  outcomes: [
    {
      key: "dinner",
      requestId: "child-a",
      listId: "list-a",
      result: {
        requestId: "child-a",
        listId: "list-a",
        listName: "Synthetic groceries",
        createdCount: 1,
        alreadyOnListCount: 0,
        possibleDuplicates: [
          { ingredientId: "ingredient-a", matchedItemId: "item-a" },
        ],
        possibleDuplicatesTruncated: false,
        undoExpiresAt: new Date(Date.now() + 60000).toISOString(),
      },
    },
  ],
});
it("performs no read or Undo on mount and requires an explicit original target tap", () => {
  const onRead = jest.fn(),
    onUndo = jest.fn();
  render(
    <FoodGroceryOutcomesView
      outcome={outcome()}
      busy={false}
      onRead={onRead}
      onUndo={onUndo}
    />,
  );
  expect(onRead).not.toHaveBeenCalled();
  expect(onUndo).not.toHaveBeenCalled();
  expect(screen.getByText(/Original add receipt/)).toBeInTheDocument();
  expect(screen.getByText(/No items were merged/)).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Undo this grocery add" }),
  );
  expect(onUndo).toHaveBeenCalledWith("child-a");
});
it("retains unknown Undo with an exact retry action and prevents expired actions", () => {
  const props = {
    outcome: outcome(),
    busy: false,
    onRead: jest.fn(),
    onUndo: jest.fn(),
    undos: { "child-a": "unknown" as const },
  };
  const view = render(<FoodGroceryOutcomesView {...props} />);
  expect(screen.getByText(/Undo result unconfirmed/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry same Undo" }));
  expect(props.onUndo).toHaveBeenCalledWith("child-a");
  const expired = outcome();
  expired.outcomes[0].result!.undoExpiresAt = "2020-01-01T00:00:00.000Z";
  view.rerender(<FoodGroceryOutcomesView {...props} outcome={expired} />);
  expect(
    screen.queryByRole("button", { name: "Retry same Undo" }),
  ).not.toBeInTheDocument();
});
it("does not equate unavailable details with a failed meal save", () => {
  render(
    <FoodGroceryOutcomesView
      readError
      busy={false}
      onRead={jest.fn()}
      onUndo={jest.fn()}
    />,
  );
  expect(screen.getByText(/meal save is still confirmed/)).toBeInTheDocument();
});
