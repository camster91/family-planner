import { useTranslation } from "@/i18n";
const en = {
  cookingPortions: "Cooking portions",
  cookingOriginal: "Original · {count}",
  cookingPreview: "Preview only. Ingredient amounts change; directions and times keep their original text. The saved recipe stays unchanged.",
  cookingInvalid: "Choose a whole number from 1 to 100. Original amounts are shown.",
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
  ownerChanged: "Reload recipes",
  ownerChangedDescription: "Your account or household context could not be confirmed. Reload before continuing.",
  reload: "Reload",
  edit: "Edit recipe",
  editDescription: "Changes apply to this recipe. Planned meals keep their saved name.",
} as const;
const es: Record<keyof typeof en, string> = {
  cookingPortions: "Porciones para cocinar",
  cookingOriginal: "Original · {count}",
  cookingPreview: "Vista previa. Solo cambian las cantidades de ingredientes; los pasos y tiempos conservan el texto original. La receta guardada no cambia.",
  cookingInvalid: "Elige un número entero de 1 a 100. Se muestran las cantidades originales.",
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
  ownerChanged: "Vuelve a cargar las recetas",
  ownerChangedDescription: "No se pudo confirmar tu cuenta o el contexto de tu hogar. Vuelve a cargar antes de continuar.",
  reload: "Volver a cargar",
  edit: "Editar receta",
  editDescription: "Los cambios se aplican a esta receta. Las comidas planificadas conservan su nombre guardado.",
};
export function useRecipeDetailText() {
  const { t } = useTranslation();
  return (key: keyof typeof en, params?: Record<string, string | number>) => t(key, params, { en, es });
}
