"use client";
import { useCallback } from "react";
import { useTranslation } from "@/i18n";

// Recipe chrome only: authored titles, ingredients, units and instructions are
// household content and must never be translated or rewritten by these keys.
export const recipePresentationEnglish = {
  prep: "Prep",
  cook: "Cook",
  serves: "Serves",
  original: "Original recipe",
  ingredients: "Ingredients",
  noIngredients: "No ingredients listed for this recipe.",
  method: "Method",
  pickerLoading: "Loading recipes…",
  pickerFailed: "Couldn’t load recipes. You can still save the meal by name.",
  pickerEmptyCreate: "No recipes yet. Create one with “New recipe”.",
  pickerEmpty: "No recipes yet.",
  pickerLabel: "Recipe (optional)",
  noRecipe: "No recipe (just a name)",
  newRecipe: "New recipe",
  retry: "Try again",
  reuseLabel: "Reuse saved recipe",
  reuseReview: "Review the day and portions before saving. This uses the same saved recipe.",
  reuseFailed: "We could not load this recipe. It may be unavailable in your current household.",
  reuseLoading: "Loading saved recipe…",
  usePrep: "Use in a prep session",
  useMeal: "Plan this recipe",
  dismiss: "Dismiss",
};
export const recipePresentationSpanish: Record<keyof typeof recipePresentationEnglish, string> = {
  prep: "Preparación",
  cook: "Cocción",
  serves: "Porciones",
  original: "Receta original",
  ingredients: "Ingredientes",
  noIngredients: "Esta receta no tiene ingredientes registrados.",
  method: "Pasos",
  pickerLoading: "Cargando recetas…",
  pickerFailed: "No se pudieron cargar las recetas. Puedes guardar la comida solo con un nombre.",
  pickerEmptyCreate: "Aún no hay recetas. Crea una con «Nueva receta».",
  pickerEmpty: "Aún no hay recetas.",
  pickerLabel: "Receta (opcional)",
  noRecipe: "Sin receta (solo un nombre)",
  newRecipe: "Nueva receta",
  retry: "Reintentar",
  reuseLabel: "Reutilizar receta guardada",
  reuseReview: "Revisa el día y las porciones antes de guardar. Se usa la misma receta guardada.",
  reuseFailed: "No pudimos cargar esta receta. Puede no estar disponible en tu hogar actual.",
  reuseLoading: "Cargando receta guardada…",
  usePrep: "Usar en una preparación",
  useMeal: "Planificar esta receta",
  dismiss: "Descartar",
};
const messages = { en: recipePresentationEnglish, es: recipePresentationSpanish };
export function useRecipePresentationText() {
  const { t } = useTranslation();
  return useCallback((key: keyof typeof recipePresentationEnglish) => t(key, undefined, messages), [t]);
}
