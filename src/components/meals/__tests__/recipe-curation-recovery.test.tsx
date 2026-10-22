/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RecipeCuration } from "../RecipeCuration";
const response = (body: unknown) => ({ ok: true, json: async () => body });
test("an uncertain favorite write retains the choice and requires explicit refresh and review before another write", async () => {
  let revision = 0;
  let writes = 0;
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      writes++;
      if (writes === 1) {
        revision = 1;
        throw new Error("Fixture lost response");
      }
      const input = JSON.parse(String(init.body));
      return response({
        id: "fx_recipe",
        revision: 2,
        favorite: input.favorite,
        collectionIds: input.collectionIds,
      });
    }
    return String(url).endsWith("/collections")
      ? response({ collections: [] })
      : response({
          id: "fx_recipe",
          revision,
          favorite: false,
          collectionIds: [],
        });
  }) as unknown as typeof fetch;
  render(<RecipeCuration id="fx_recipe" title="Fixture soup" />);
  fireEvent.click(
    screen.getByRole("button", { name: "Organize recipe: Fixture soup" }),
  );
  const checkbox = await screen.findByRole("checkbox", {
    name: "Household favorite",
  });
  await waitFor(() => expect(checkbox).toBeEnabled());
  fireEvent.click(checkbox);
  fireEvent.click(screen.getByRole("button", { name: "Save choices" }));
  await screen.findByRole("alert");
  expect(checkbox).toBeChecked();
  expect(writes).toBe(1);
  expect(screen.getByRole("button", { name: "Save choices" })).toBeDisabled();
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh current settings" }),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Save choices" })).toBeEnabled(),
  );
  expect(checkbox).toBeChecked();
  expect(writes).toBe(1);
  fireEvent.click(screen.getByRole("button", { name: "Save choices" }));
  await waitFor(() => expect(writes).toBe(2));
  const second = (global.fetch as jest.Mock).mock.calls.filter(
    ([, init]) => init?.method === "PATCH",
  )[1][1];
  expect(JSON.parse(second.body)).toEqual({
    revision: 1,
    favorite: true,
    collectionIds: [],
  });
});
