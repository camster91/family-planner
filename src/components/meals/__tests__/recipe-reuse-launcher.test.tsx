/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { RecipeReuseLauncher } from "../RecipeReuseLauncher";
const reply = (id: string) => ({
  ok: true,
  json: async () => ({
    recipe: {
      id,
      title: `Saved ${id}`,
      servings: 6,
      prep_time: 10,
      cook_time: 20,
    },
  }),
});
const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});
it("reads canonical metadata without writing and requires an explicit editor action", async () => {
  global.fetch = jest.fn(async () => reply("fixture_recipe")) as typeof fetch;
  const use = jest.fn();
  render(
    <RecipeReuseLauncher
      recipeId="fixture_recipe"
      kind="meal"
      onUse={use}
      onDismiss={jest.fn()}
    />,
  );
  await screen.findByText("Saved fixture_recipe");
  expect(use).not.toHaveBeenCalled();
  expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe(
    "/api/recipes/fixture_recipe",
  );
  fireEvent.click(screen.getByRole("button", { name: "Plan this recipe" }));
  expect(use).toHaveBeenCalledWith(
    expect.objectContaining({ id: "fixture_recipe", servings: 6 }),
  );
  expect(global.fetch).toHaveBeenCalledTimes(1);
});
it("drops old metadata when a route names another recipe", async () => {
  let finish!: (value: unknown) => void;
  global.fetch = jest.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  ) as typeof fetch;
  const view = render(
    <RecipeReuseLauncher
      recipeId="fixture_old"
      kind="prep"
      onUse={jest.fn()}
      onDismiss={jest.fn()}
    />,
  );
  const old = finish;
  view.rerender(
    <RecipeReuseLauncher
      recipeId="fixture_new"
      kind="prep"
      onUse={jest.fn()}
      onDismiss={jest.fn()}
    />,
  );
  await act(async () => {
    old(reply("fixture_old"));
  });
  expect(screen.queryByText("Saved fixture_old")).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Use in a prep session" }),
  ).toBeNull();
});
