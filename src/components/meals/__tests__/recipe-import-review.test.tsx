/** @jest-environment jsdom */
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));
jest.mock("@/lib/review-document-browser", () =>
  require("@/__tests__/helpers/legacy-recipe-review").legacyRecipeReviewMock(),
);
import { fireEvent, render, screen } from "@testing-library/react";
import { RecipeEditor } from "../RecipeEditor";
const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});
it("leaves imported unknown servings empty and refuses a guessed default", async () => {
  global.fetch = jest.fn() as typeof fetch;
  render(
    <RecipeEditor
      onCancel={jest.fn()}
      initialDraft={{
        title: "Fixture soup",
        servings: null,
        description: "",
        instructions: "Stir",
        prep_time: null,
        cook_time: null,
      }}
    />,
  );
  expect(
    await screen.findByRole("textbox", { name: "Base servings" }),
  ).toHaveValue("");
  fireEvent.click(screen.getByRole("button", { name: "Save recipe" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Base servings must be a whole number from 1 to 100.",
  );
  expect(global.fetch).not.toHaveBeenCalled();
});
it("preserves an over-limit imported method and asks for explicit shortening before any request", async () => {
  global.fetch = jest.fn() as typeof fetch;
  const method = `${"a".repeat(20000)} last original direction`;
  render(
    <RecipeEditor
      onCancel={jest.fn()}
      initialDraft={{
        title: "Fixture soup",
        servings: 4,
        description: "",
        instructions: method,
        prep_time: null,
        cook_time: null,
      }}
    />,
  );
  expect(await screen.findByRole("textbox", { name: "Method" })).toHaveValue(
    method,
  );
  fireEvent.click(screen.getByRole("button", { name: "Save recipe" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "nothing has been saved or removed",
  );
  expect(global.fetch).not.toHaveBeenCalled();
  expect(await screen.findByRole("textbox", { name: "Method" })).toHaveValue(
    method,
  );
});
