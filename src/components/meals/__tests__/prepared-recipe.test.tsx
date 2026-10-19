/** @jest-environment jsdom */
/** Source for the consolidated UI pass; no network or database. */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { PreparedRecipe } from "../PreparedRecipe";
const response = (body: unknown) => ({ ok: true, json: async () => body });
const recorded = (batchId: string, title: string) => ({
  batchId,
  state: "recorded",
  capturedAt: "2026-10-19T16:00:00.000Z",
  snapshot: {
    v: 1,
    recipe: {
      id: "fixture_recipe",
      title,
      description: null,
      instructions: "Recorded method",
      source_url: null,
      revision: 1,
      servings: 4,
      prep_time: null,
      cook_time: 30,
      ingredients: [],
    },
  },
});
const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});
it("reports missing legacy evidence without loading today's canonical recipe", async () => {
  global.fetch = jest.fn(async () =>
    response({ batchId: "fixture_batch", state: "not-recorded" }),
  ) as typeof fetch;
  render(<PreparedRecipe batchId="fixture_batch" />);
  fireEvent.click(screen.getByRole("button", { name: "Recipe used" }));
  await screen.findByText(/Recipe details were not recorded/);
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe(
    "/api/meals/bulk/fixture_batch/recipe",
  );
  expect(screen.queryByTestId("recipe-detail")).toBeNull();
});
it("renders archived evidence and never asks for the current recipe", async () => {
  global.fetch = jest.fn(async () =>
    response(recorded("fixture_batch", "Original fixture soup")),
  ) as typeof fetch;
  render(<PreparedRecipe batchId="fixture_batch" />);
  fireEvent.click(screen.getByRole("button", { name: "Recipe used" }));
  await screen.findByRole("heading", { name: "Original fixture soup" });
  expect(screen.getByText("Recorded method")).toBeTruthy();
  expect(global.fetch).toHaveBeenCalledTimes(1);
});
it("drops a late response after the selected batch changes", async () => {
  let resolveFirst!: (value: unknown) => void;
  global.fetch = jest.fn(
    () =>
      new Promise((resolve) => {
        resolveFirst = resolve;
      }),
  ) as typeof fetch;
  const view = render(<PreparedRecipe batchId="fixture_old" />);
  fireEvent.click(screen.getByRole("button", { name: "Recipe used" }));
  view.rerender(<PreparedRecipe batchId="fixture_new" />);
  await act(async () => {
    resolveFirst(response(recorded("fixture_old", "Old household fixture")));
  });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByText("Old household fixture")).toBeNull();
});
it("refuses future record formats without a guessed current-recipe fallback", async () => {
  const body = recorded("fixture_batch", "Future fixture");
  body.snapshot.v = 2;
  global.fetch = jest.fn(async () => response(body)) as typeof fetch;
  render(<PreparedRecipe batchId="fixture_batch" />);
  fireEvent.click(screen.getByRole("button", { name: "Recipe used" }));
  await screen.findByRole("alert");
  expect(screen.queryByText("Future fixture")).toBeNull();
  expect(global.fetch).toHaveBeenCalledTimes(1);
});
