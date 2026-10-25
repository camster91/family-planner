"use client";
import { useCallback } from "react";
import { useTranslation } from "@/i18n";
// Query words remain literal; labels never grant role/feature access.
export const commandPaletteEnglish = {
  title: "Command palette",
  searchLabel: "Search or go to a page",
  searchPlaceholder: "Search or type a command…",
  clearSearch: "Clear search",
  householdSearch: "Search the household for “{query}”",
  goTo: "Go to",
  results: "Results",
  noResults: "No results for “{query}”",
  toggleHint: "to toggle",
  navigateHint: "navigate",
  selectHint: "select",
};
export const commandPaletteSpanish: Record<keyof typeof commandPaletteEnglish, string> = {
  title: "Paleta de comandos",
  searchLabel: "Buscar o ir a una página",
  searchPlaceholder: "Busca o escribe un comando…",
  clearSearch: "Borrar búsqueda",
  householdSearch: "Buscar «{query}» en el hogar",
  goTo: "Ir a",
  results: "Resultados",
  noResults: "No hay resultados para «{query}»",
  toggleHint: "abrir o cerrar",
  navigateHint: "navegar",
  selectHint: "seleccionar",
};
const messages = { en: commandPaletteEnglish, es: commandPaletteSpanish };
export function useCommandPaletteText() {
  const { t } = useTranslation();
  return useCallback(
    (key: keyof typeof commandPaletteEnglish, params?: Record<string, string | number>) => t(key, params, messages),
    [t],
  );
}
