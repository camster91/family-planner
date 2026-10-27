/** @jest-environment jsdom */
// Authored for deferred QA; no rendered/locale acceptance is claimed.
import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider, useTranslation } from "@/i18n";
import { RecipeDetail, type RecipeDetailData } from "../RecipeDetail";
import { RecipePicker } from "../RecipePicker";
import { RecipeReuseLauncher } from "../RecipeReuseLauncher";
const recipe: RecipeDetailData = {
  id: "fixture-recipe", title: "Author's soup", source_url: "https://publisher.example/recipe",
  description: "Author's description", instructions: "Keep this instruction exactly.",
  prep_time: 10, cook_time: 20, servings: 4,
  ingredients: [{ id: "fixture-line", amount: 1.5, unit: "cup", note: "Author's note",
    ingredient: { id: "fixture-ingredient", name: "Author's ingredient", unit: "cup" } }],
};
const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });
function LocaleControl() {
  const { setLocale } = useTranslation();
  return <button onClick={() => setLocale("es")}>Fixture language</button>;
}
it("switches mounted recipe chrome and picker state without reloading or translating authored values", async () => {
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ recipes: [recipe], nextOffset: null }) })) as unknown as typeof fetch;
  const changed = jest.fn();
  render(<I18nProvider locale="en" persistLocale={false}>
    <LocaleControl />
    <RecipeDetail recipe={recipe} />
    <RecipePicker value={recipe.id} initialRecipe={recipe} canCreate={false} onChange={changed} />
  </I18nProvider>);
  const picker = await screen.findByRole("combobox", { name: "Recipe (optional)" });
  await screen.findByRole("option", { name: recipe.title });
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "Fixture language" }));
  expect(screen.getByRole("combobox", { name: "Receta (opcional)" })).toBe(picker);
  expect((picker as HTMLSelectElement).value).toBe(recipe.id);
  expect(screen.getByRole("heading", { name: "Ingredientes" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Pasos" })).toBeTruthy();
  expect(screen.getByRole("link", { name: /Receta original/ }).getAttribute("href")).toBe(recipe.source_url);
  expect(screen.getByText(recipe.instructions!)).toBeTruthy();
  expect(screen.getByText("Author's ingredient")).toBeTruthy();
  expect(screen.getByText("1,5 cup")).toBeTruthy();
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(changed).not.toHaveBeenCalled();
});
it("localizes saved-recipe reuse review and action without opening or writing automatically", async () => {
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ recipe }) })) as unknown as typeof fetch;
  const use = jest.fn();
  render(<I18nProvider locale="es" persistLocale={false}>
    <RecipeReuseLauncher recipeId={recipe.id} kind="prep" onUse={use} onDismiss={jest.fn()} />
  </I18nProvider>);
  await screen.findByText(recipe.title);
  expect(screen.getByRole("region", { name: "Reutilizar receta guardada" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Descartar" })).toBeTruthy();
  expect(use).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Usar en una preparación" }));
  expect(use).toHaveBeenCalledWith(expect.objectContaining({ id: recipe.id }));
  expect(global.fetch).toHaveBeenCalledTimes(1);
});
