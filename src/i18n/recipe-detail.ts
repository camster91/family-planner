import { useTranslation } from "@/i18n";
const en = {
  meals: "Meals",
  reviewUsed: "Review food used",
  planMeal: "Plan a meal",
  addPrep: "Add to prep",
  loading: "Loading recipe",
  notFound: "Recipe not found",
  notFoundDescription: "It may have been deleted. Meals that used it keep their name.",
  back: "Back to meals",
  failed: "Couldn’t load this recipe",
  failedDescription: "Check your connection and try again.",
  retry: "Try again",
  edit: "Edit recipe",
  editDescription: "Changes apply to this recipe. Planned meals keep their saved name.",
} as const;
const es: Record<keyof typeof en, string> = {
  meals: "Comidas",
  reviewUsed: "Revisar alimentos usados",
  planMeal: "Planificar comida",
  addPrep: "Añadir a una preparación",
  loading: "Cargando receta",
  notFound: "No se encontró la receta",
  notFoundDescription: "Puede haberse eliminado. Las comidas que la usaron conservan su nombre.",
  back: "Volver a comidas",
  failed: "No se pudo cargar esta receta",
  failedDescription: "Revisa tu conexión y vuelve a intentarlo.",
  retry: "Reintentar",
  edit: "Editar receta",
  editDescription: "Los cambios se aplican a esta receta. Las comidas planificadas conservan su nombre guardado.",
};
export function useRecipeDetailText() {
  const { t } = useTranslation();
  return (key: keyof typeof en) => t(key, undefined, { en, es });
}
