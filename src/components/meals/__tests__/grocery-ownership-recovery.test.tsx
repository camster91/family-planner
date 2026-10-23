/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AddToGroceriesButton } from "../AddToGroceriesButton";
jest.mock("@/components/layout/pending-form-navigation", () => ({
  usePendingFormNavigationController: () => ({
    releaseBeforeNavigation: async () => true,
  }),
}));
const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});
it("keeps the reader owner and exact add after lost response then a later refusal", async () => {
  let count = 0;
  const ownership = jest.fn();
  global.fetch = jest.fn(async (_url, init) => {
    if (init?.method !== "POST")
      return {
        ok: true,
        status: 200,
        json: async () => ({
          recipeId: "recipe",
          title: "Soup",
          baseServings: 4,
          targetServings: 4,
          ingredients: [
            { ingredientId: "beans", name: "Beans", amount: 2, unit: "cups" },
          ],
          lists: [],
          defaultListId: null,
          inventory: { state: "unavailable" },
        }),
      };
    if (++count === 1) throw new Error("Fixture lost response");
    return count === 2
      ? {
          ok: false,
          status: 403,
          json: async () => ({ error: "Fixture household changed" }),
        }
      : {
          ok: true,
          status: 201,
          headers: new Headers(),
          json: async () => ({
            requestId: "receipt",
            listId: "list",
            listName: "Groceries",
            createdCount: 0,
            alreadyOnListCount: 1,
            possibleDuplicates: [],
            possibleDuplicatesTruncated: false,
          }),
        };
  }) as unknown as typeof fetch;
  render(
    <AddToGroceriesButton recipeId="recipe" onPendingChange={ownership} />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Add ingredients to groceries" }),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Add selected ingredients" }),
  );
  await screen.findByRole("button", { name: "Try again" });
  expect(ownership).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByText("Fixture household changed");
  expect(ownership).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(ownership).toHaveBeenLastCalledWith(false));
  const requests = (global.fetch as jest.Mock).mock.calls
    .filter(([, init]) => init?.method === "POST")
    .map(([, init]) => ({
      body: init.body,
      key: init.headers["Idempotency-Key"],
    }));
  expect(requests).toHaveLength(3);
  expect(requests[1]).toEqual(requests[0]);
  expect(requests[2]).toEqual(requests[0]);
});
