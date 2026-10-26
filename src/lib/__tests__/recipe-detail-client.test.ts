// Authored source cases for deferred QA; no execution claimed.
import { readRecipeDetail, RecipeDetailNotFound } from "../recipe-detail-client";
const recipe = {
  id: "recipe-a", title: "Soup", description: null, instructions: "Simmer",
  prep_time: 5, cook_time: 20, servings: 4,
  ingredients: [{ id: "line-a", amount: 1, unit: null, note: null,
    ingredient: { id: "ingredient-a", name: "Carrots", unit: null } }],
};
const transportFor = (body: unknown) => jest.fn(async () => ({ ok: true, status: 200,
  json: async () => body }) as Response);
afterEach(() => jest.useRealTimers());

it("projects canonical detail without unrelated private fields or extra requests", async () => {
  const transport = transportFor({ recipe: { ...recipe, created_by: "actor-private", family_id: "household-private" } });
  await expect(readRecipeDetail("recipe-a", new AbortController().signal, { fetchImpl: transport })).resolves.toEqual(recipe);
  expect(transport).toHaveBeenCalledTimes(1);
});
it.each([
  { ...recipe, id: "recipe-b" },
  { ...recipe, ingredients: [{ ...recipe.ingredients[0], ingredient: null }] },
  { ...recipe, ingredients: [...recipe.ingredients, ...recipe.ingredients] },
])("refuses mismatched or inconsistent detail before rendering action inputs", async invalid => {
  await expect(readRecipeDetail("recipe-a", new AbortController().signal,
    { fetchImpl: transportFor({ recipe: invalid }) })).rejects.toThrow("Recipe detail unavailable");
});
it("treats canonical missing/foreign 404 alike without decoding its body", async () => {
  const json = jest.fn();
  const transport = jest.fn(async () => ({ ok: false, status: 404, json }) as unknown as Response);
  await expect(readRecipeDetail("recipe-a", new AbortController().signal,
    { fetchImpl: transport })).rejects.toBeInstanceOf(RecipeDetailNotFound);
  expect(json).not.toHaveBeenCalled();
});
it("bounds detail response size before decoding", async () => {
  const json = jest.fn();
  const transport = jest.fn(async () => ({ ok: true, status: 200,
    headers: new Headers({ "content-length": String(1024 * 1024 + 1) }), json }) as unknown as Response);
  await expect(readRecipeDetail("recipe-a", new AbortController().signal,
    { fetchImpl: transport })).rejects.toThrow("Recipe detail unavailable");
  expect(json).not.toHaveBeenCalled();
});
it("settles a bridge that ignores cancellation without accepting its late body", async () => {
  jest.useFakeTimers();
  const transport = jest.fn(async () => ({ ok: true, status: 200,
    json: () => new Promise(() => undefined) }) as unknown as Response);
  const pending = readRecipeDetail("recipe-a", new AbortController().signal,
    { fetchImpl: transport, timeoutMs: 1000 });
  const refusal = expect(pending).rejects.toThrow("Recipe detail unavailable");
  await jest.advanceTimersByTimeAsync(1000);
  await refusal;
  expect(transport).toHaveBeenCalledTimes(1);
});
