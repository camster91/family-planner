"use client";
import { useCallback } from "react";
import { useTranslation } from "@/i18n";
// Entry/suggestion presentation only; suggestions never become saved commands here.
export const foodPlanningEntryEnglish = {
  aiChoices: "AI meal choices",
  aiReview: "AI choices to review",
  aiBoundary: "Chosen from your saved household recipes. These are suggestions, not dietary or food-safety advice. Check your preferences and ingredient details. Nothing has been saved.",
  heldChoices: "{count} choices need attention before saving.",
  noHolds: "Recorded checks found no holds. Review the details before saving.",
  expired: "These choices expired. Ask AI again or use Find suggestions. Your draft is kept.",
  useBoundary: "Use copies the recipes into your draft and refreshes the household checks. Grocery selections for changed recipes are cleared. Save still needs your separate review and confirmation. Suggestions expire after one minute.",
  usageCounts: "Your household has usage counts on. Use/Keep shares one choice count without recipe details or your preference. You can turn counts off in Settings.",
  useChoices: "Use these choices",
  keepChoices: "Keep my choices",
  savedFoodWork: "Saved food work",
  severalDishes: "Plan several dishes",
  severalMeals: "Plan several meals",
  loadingPlanner: "Loading planner…",
};
export const foodPlanningEntrySpanish: Record<keyof typeof foodPlanningEntryEnglish, string> = {
  aiChoices: "Opciones de comidas con IA",
  aiReview: "Opciones de IA para revisar",
  aiBoundary: "Elegidas de las recetas guardadas de tu hogar. Son sugerencias, no consejos dietéticos ni de seguridad alimentaria. Revisa tus preferencias e ingredientes. Aún no se ha guardado nada.",
  heldChoices: "{count} opciones necesitan revisión antes de guardar.",
  noHolds: "Las comprobaciones registradas no encontraron impedimentos. Revisa los detalles antes de guardar.",
  expired: "Estas opciones han caducado. Vuelve a preguntar a la IA o usa Buscar sugerencias. Se conserva el borrador.",
  useBoundary: "Usar copia las recetas al borrador y actualiza las comprobaciones del hogar. Se quitan las selecciones de compra de las recetas cambiadas. Guardar requiere revisión y confirmación aparte. Las sugerencias caducan al minuto.",
  usageCounts: "Tu hogar tiene los recuentos de uso activados. Usar/Conservar comparte un recuento sin detalles de recetas ni tu preferencia. Puedes desactivarlos en Ajustes.",
  useChoices: "Usar estas opciones",
  keepChoices: "Conservar mis opciones",
  savedFoodWork: "Trabajo de comidas guardado",
  severalDishes: "Planificar varios platos",
  severalMeals: "Planificar varias comidas",
  loadingPlanner: "Cargando planificador…",
};
const messages = { en: foodPlanningEntryEnglish, es: foodPlanningEntrySpanish };
export function useFoodPlanningEntryText() {
  const { t } = useTranslation();
  return useCallback(
    (key: keyof typeof foodPlanningEntryEnglish, params?: Record<string, string | number>) => t(key, params, messages),
    [t],
  );
}
