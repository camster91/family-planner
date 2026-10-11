import { useCallback } from "react";
import { useTranslation } from "@/i18n";

/** Recipe-editor controls and recovery copy. Recipe content stays verbatim. */
export const recipeEditorEnglish = {
  newRecipe: "New recipe",
  recipeDetails: "Recipe details",
  recipeName: "Recipe name",
  baseServings: "Base servings",
  servingsHint:
    "The ingredient amounts below make this many servings (1–100). Grocery requests have a separate 1–50 limit.",
  description: "Description",
  method: "Method",
  prepMinutes: "Prep (min)",
  cookMinutes: "Cook (min)",
  ingredientsOptional: "Ingredients (optional)",
  ingredientsOrderHint:
    "Saved ingredients are displayed by name. Line entry order is not saved.",
  ingredientGroup: "Ingredient {number}",
  amount: "Amount",
  unit: "Unit",
  ingredient: "Ingredient",
  ingredientNote: "Ingredient note",
  removeIngredient: "Remove ingredient {number}",
  addIngredient: "Add ingredient",
  cancel: "Cancel",
  saving: "Saving…",
  saveRecipe: "Save recipe",
  emptyTitle: "Give the recipe a name.",
  invalidServings: "Base servings must be a whole number from 1 to 100.",
  invalidTimes: "Times must be whole minutes, up to 1440.",
  existingIngredientName:
    "Keep an ingredient name, or use Remove ingredient to remove the line.",
  invalidAmount: "Amount for “{name}” must be a number from 0 to 100000.",
  tooManyIngredients: "A recipe can have at most 100 ingredients.",
  uncertain:
    "The recipe may have been saved, but we couldn’t confirm it. Close this editor and reload recipes to check before creating or saving again.",
  rejected: "The recipe was not accepted. Check your entries and permissions.",
} as const;

export type RecipeEditorMessage = keyof typeof recipeEditorEnglish;

export const recipeEditorSpanish: Record<RecipeEditorMessage, string> = {
  newRecipe: "Nueva receta",
  recipeDetails: "Detalles de la receta",
  recipeName: "Nombre de la receta",
  baseServings: "Porciones base",
  servingsHint:
    "Las cantidades de ingredientes indican estas porciones (1–100). Las solicitudes de compra tienen un límite aparte de 1–50.",
  description: "Descripción",
  method: "Preparación",
  prepMinutes: "Preparación (min)",
  cookMinutes: "Cocción (min)",
  ingredientsOptional: "Ingredientes (opcional)",
  ingredientsOrderHint:
    "Los ingredientes guardados se muestran por nombre. El orden de las líneas no se guarda.",
  ingredientGroup: "Ingrediente {number}",
  amount: "Cantidad",
  unit: "Unidad",
  ingredient: "Ingrediente",
  ingredientNote: "Nota del ingrediente",
  removeIngredient: "Quitar ingrediente {number}",
  addIngredient: "Añadir ingrediente",
  cancel: "Cancelar",
  saving: "Guardando…",
  saveRecipe: "Guardar receta",
  emptyTitle: "Escribe un nombre para la receta.",
  invalidServings:
    "Las porciones base deben ser un número entero del 1 al 100.",
  invalidTimes: "Los tiempos deben ser minutos enteros, hasta 1440.",
  existingIngredientName:
    "Escribe el nombre de un ingrediente o usa Quitar ingrediente para eliminar la línea.",
  invalidAmount: "La cantidad de «{name}» debe ser un número del 0 al 100000.",
  tooManyIngredients: "Una receta puede tener como máximo 100 ingredientes.",
  uncertain:
    "Es posible que la receta se haya guardado, pero no pudimos confirmarlo. Cierra este editor y vuelve a cargar las recetas antes de crear o guardar otra vez.",
  rejected: "No se aceptó la receta. Revisa los datos y tus permisos.",
};

export const recipeEditorMessages = {
  en: recipeEditorEnglish,
  es: recipeEditorSpanish,
};

export function useRecipeEditorText() {
  const { t: translate } = useTranslation();
  return useCallback(
    (key: RecipeEditorMessage, params?: Record<string, string | number>) =>
      translate(key, params, recipeEditorMessages),
    [translate],
  );
}
