/** Budget recovery and retry copy. Amounts, labels, and transaction content stay verbatim. */
import { useTranslation } from "@/i18n";

export const budgetEnglish = {
  refreshBudget: "Refresh budget",
  refreshingBudget: "Refreshing budget",
  refreshFailed:
    "Budget could not be refreshed. Showing saved rows while you retry.",
  refreshNetworkError:
    "Budget could not be refreshed. Check your connection and try again.",
  retryRefresh: "Retry budget refresh",
  loadingCategories: "Loading categories…",
  categoriesUnavailable:
    "Categories could not be refreshed. Your saved categories are still shown.",
  categoriesNetworkError:
    "Categories could not be refreshed. Check your connection and try again.",
  retryCategories: "Retry categories",
  noCategories: "No {type} categories yet. Create one in Category Manager.",
  income: "income",
  expense: "expense",
  saveFailed: "Failed to save transaction",
  saveNetworkError: "Network error. Please try again.",
  deleteFailed: "Couldn't delete the transaction",
  deleteNetworkError: "Network error. Please try again.",
} as const;

export type BudgetMessage = keyof typeof budgetEnglish;

export const budgetSpanish: Record<BudgetMessage, string> = {
  refreshBudget: "Actualizar presupuesto",
  refreshingBudget: "Actualizando presupuesto",
  refreshFailed:
    "No se pudo actualizar el presupuesto. Se muestran las filas guardadas mientras reintentas.",
  refreshNetworkError:
    "No se pudo actualizar el presupuesto. Revisa tu conexión e inténtalo de nuevo.",
  retryRefresh: "Reintentar actualización del presupuesto",
  loadingCategories: "Cargando categorías…",
  categoriesUnavailable:
    "No se pudieron actualizar las categorías. Tus categorías guardadas siguen visibles.",
  categoriesNetworkError:
    "No se pudieron actualizar las categorías. Revisa tu conexión e inténtalo de nuevo.",
  retryCategories: "Reintentar categorías",
  noCategories:
    "Todavía no hay categorías de {type}. Crea una en el administrador de categorías.",
  income: "ingreso",
  expense: "gasto",
  saveFailed: "No se pudo guardar la transacción",
  saveNetworkError: "Error de conexión. Inténtalo de nuevo.",
  deleteFailed: "No se pudo eliminar la transacción",
  deleteNetworkError: "Error de conexión. Inténtalo de nuevo.",
};

export const budgetMessages = {
  en: budgetEnglish,
  es: budgetSpanish,
};

export function useBudgetText() {
  const { t: translate } = useTranslation();
  return (key: BudgetMessage, params?: Record<string, string | number>) =>
    translate(key, params, budgetMessages);
}
