import { useCallback } from "react";
import { useTranslation } from "@/i18n";

/** Recipe-editor controls and recovery copy. Recipe content stays verbatim. */
export const recipeEditorEnglish = {
  sourceLink: "Original source ↗",
  sourceCopy: "Save a separate copy of this source",
  sourceExists:
    "This source is already saved. Open it to view or edit, or choose a separate copy.",
  openExisting: "Open saved recipe: {title}",
  sourceCheckUnavailable:
    "We could not finish checking older imports. Keep this draft; check your recipe box, or deliberately choose a separate copy.",
  revisionConflict:
    "This recipe changed elsewhere. Your edits are kept here. Close and reload the saved recipe before applying them again.",
  uncertainCreate:
    "The recipe may have been saved. Check the same save to confirm it without creating a second recipe. These fields stay locked until confirmed; closing keeps the server result unchanged.",
  retryCreate: "Check the same save",
  expiredCreate:
    "This save is too old to retry safely. Close and check your recipe box before making a separate new recipe.",
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
  sourceLink: "Fuente original ↗",
  sourceCopy: "Guardar una copia separada de esta fuente",
  sourceExists:
    "Esta fuente ya está guardada. Ábrela para ver o editar, o elige una copia separada.",
  openExisting: "Abrir receta guardada: {title}",
  sourceCheckUnavailable:
    "No pudimos terminar de comprobar las importaciones antiguas. Conserva el borrador y revisa tus recetas, o elige una copia separada.",
  revisionConflict:
    "La receta cambió en otro lugar. Tus cambios se conservan aquí. Cierra y vuelve a cargar la receta antes de aplicarlos de nuevo.",
  uncertainCreate:
    "La receta puede haberse guardado. Comprueba el mismo guardado para confirmarlo sin crear otra receta. Los campos quedan bloqueados hasta confirmarlo; cerrar no cambia el resultado del servidor.",
  retryCreate: "Comprobar el mismo guardado",
  expiredCreate:
    "Este guardado es demasiado antiguo para repetirlo con seguridad. Cierra y revisa las recetas guardadas antes de crear otra receta.",
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
