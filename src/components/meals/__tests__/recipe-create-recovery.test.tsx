/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RecipeEditor } from "../RecipeEditor";
test("uncertain creation retries exactly its original tagged body and key, with fields locked", async () => {
  const created = jest.fn();
  global.fetch = jest
    .fn()
    .mockRejectedValueOnce(new Error("Fixture lost acknowledgement"))
    .mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({
        recipe: {
          id: "fx_recipe",
          title: "Fixture soup",
          servings: 2,
          prep_time: null,
          cook_time: null,
        },
      }),
    });
  render(<RecipeEditor onCreated={created} onCancel={() => {}} />);
  fireEvent.change(screen.getByLabelText("Recipe name"), {
    target: { value: "Fixture soup" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save recipe" }));
  await screen.findByRole("button", { name: "Check the same save" });
  expect(screen.getByLabelText("Recipe name")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Check the same save" }));
  await waitFor(() => expect(created).toHaveBeenCalledTimes(1));
  const first = (global.fetch as jest.Mock).mock.calls[0][1];
  const retry = (global.fetch as jest.Mock).mock.calls[1][1];
  expect(first.body).toBe(retry.body);
  expect(first.headers["Idempotency-Key"]).toBe(
    retry.headers["Idempotency-Key"],
  );
  expect(JSON.parse(first.body).creation_protocol).toBe(
    "herewoven.recipe-create.v1",
  );
});
