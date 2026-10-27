"use client";
import { useCallback } from "react";
import { useTranslation } from "@/i18n";
const en = {
  add: "Add ingredients to groceries", retry: "Try again", title: "Review grocery ingredients",
  loading: "Loading ingredients…", servings: "For {count} servings", destination: "Destination list",
  createList: "Create Groceries when added", firstLists: "Showing the first 100 grocery lists.",
  empty: "This recipe has no ingredients to add.", addSelected: "Add selected ingredients",
  cancel: "Cancel", close: "Close", undo: "Undo",
  uncertain: "This request may already be saved. Try again checks the same ingredients and destination; resolve it before starting another add.",
  servingsInvalid: "Servings must be a whole number from 1 to 100.",
  listUnavailable: "The chosen grocery list is unavailable. Close and choose another list.",
  loadFailed: "Could not load ingredients. Close and try again.",
  itemOne: "{count} item", itemMany: "{count} items", addedOne: "Added {items} to {list}", addedMany: "Added {items} to {list}",
  alreadyAll: "Everything is already on {list}", already: "{items} already on the list, not added again.",
  duplicateOne: "{count} may duplicate an item already typed on the list. Check before shopping.",
  duplicateMany: "{count} may duplicate items already typed on the list. Check before shopping.",
  duplicateMore: "{count} or more may duplicate items already typed on the list. Check before shopping.",
  removedNone: "Nothing left to remove", removedOne: "Removed {items}", removedMany: "Removed {items}", kept: " ({items} already ticked, kept)",
  undone: "{removed}{kept}.",
};
export type RecipeGroceriesMessage = keyof typeof en;
const es: Record<RecipeGroceriesMessage, string> = {
  add: "Añadir ingredientes a la compra", retry: "Intentar de nuevo", title: "Revisar ingredientes para la compra",
  loading: "Cargando ingredientes…", servings: "Para {count} porciones", destination: "Lista de destino",
  createList: "Crear la lista de compra al añadir", firstLists: "Se muestran las primeras 100 listas de compra.",
  empty: "Esta receta no tiene ingredientes para añadir.", addSelected: "Añadir ingredientes seleccionados",
  cancel: "Cancelar", close: "Cerrar", undo: "Deshacer",
  uncertain: "Puede que esta solicitud ya esté guardada. Intentar de nuevo comprueba los mismos ingredientes y destino; resuélvela antes de añadir otra vez.",
  servingsInvalid: "Las porciones deben ser un número entero de 1 a 100.",
  listUnavailable: "La lista de compra elegida no está disponible. Cierra y elige otra lista.",
  loadFailed: "No se pudieron cargar los ingredientes. Cierra e inténtalo de nuevo.",
  itemOne: "{count} artículo", itemMany: "{count} artículos", addedOne: "Se añadió {items} a {list}", addedMany: "Se añadieron {items} a {list}",
  alreadyAll: "Todo está ya en {list}", already: "Ya en la lista (sin duplicar): {items}.",
  duplicateOne: "{count} podría duplicar un artículo ya escrito en la lista. Compruébalo antes de comprar.",
  duplicateMany: "{count} podrían duplicar artículos ya escritos en la lista. Compruébalo antes de comprar.",
  duplicateMore: "{count} o más podrían duplicar artículos ya escritos en la lista. Compruébalo antes de comprar.",
  removedNone: "No queda nada que eliminar", removedOne: "Se eliminó {items}", removedMany: "Se eliminaron {items}", kept: " ({items} con marca de completado; sin eliminar)",
  undone: "{removed}{kept}.",
};
export type RecipeGroceriesText = (key: RecipeGroceriesMessage, params?: Record<string, string | number>) => string;
const messages = { en, es };
export function useRecipeGroceriesText(): RecipeGroceriesText {
  const { t } = useTranslation();
  return useCallback((key, params) => t(key, params, messages), [t]);
}
