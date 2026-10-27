import { useCallback } from "react";
import { useTranslation } from "@/i18n";
const en = {
  partial: "There are more meals in this week. Load more to see the full plan.",
  moreFailed:
    "More meals could not be loaded. Your loaded meals are still here.",
  loading: "Loading more meals…",
  loadMore: "Load more meals",
  complete: "All meals loaded",
  loaded: "{count} meals loaded.",
  notLoaded: "No meals loaded yet",
  nothingPlanned: "Nothing planned",
  otherMeals: "Other meals",
};
const es: typeof en = {
  partial:
    "Hay más comidas en esta semana. Carga más para ver el plan completo.",
  moreFailed:
    "No se pudieron cargar más comidas. Las que ya están cargadas siguen aquí.",
  loading: "Cargando más comidas…",
  loadMore: "Cargar más comidas",
  complete: "Todas las comidas cargadas",
  loaded: "{count} comidas cargadas.",
  notLoaded: "Aún no se han cargado comidas",
  nothingPlanned: "Nada planificado",
  otherMeals: "Otras comidas",
};
export function useMealWeekText() {
  const { t } = useTranslation();
  return useCallback(
    (key: keyof typeof en, params?: { count: number }) =>
      t(key, params ? { count: params.count } : { count: "" }, { en, es }),
    [t],
  );
}
