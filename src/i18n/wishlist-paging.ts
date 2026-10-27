"use client";
import { useCallback } from "react";
import { useTranslation } from "@/i18n";
const en = {
  loaded: "Loaded wishes",
  loadedReady: "Ready to review in loaded wishes",
  more: "Load more wishes",
  loading: "Loading…",
  failed: "Couldn’t load more wishes. Try again.",
  partial: "Showing loaded wishes. More may be available.",
  complete: "All wishes loaded.",
  emptyPage: "No wishes in the loaded results. Load more to continue.",
};
const es: Record<keyof typeof en, string> = {
  loaded: "Deseos cargados",
  loadedReady: "Listos para revisar entre los deseos cargados",
  more: "Cargar más deseos",
  loading: "Cargando…",
  failed: "No se pudieron cargar más deseos. Inténtalo de nuevo.",
  partial: "Se muestran los deseos cargados. Puede haber más.",
  complete: "Se cargaron todos los deseos.",
  emptyPage: "No hay deseos en los resultados cargados. Carga más para continuar.",
};
const messages = { en, es };
export function useWishlistPagingText() {
  const { t } = useTranslation();
  return useCallback((key: keyof typeof en) => t(key, undefined, messages), [t]);
}
