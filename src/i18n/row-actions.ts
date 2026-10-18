"use client";
import { useTranslation } from "@/i18n";
export const rowActionMessages = {
  en: { more: "More actions", forItem: "{label} for {item}", cancel: "Cancel" },
  es: {
    more: "Más acciones",
    forItem: "{label} para {item}",
    cancel: "Cancelar",
  },
};
export function useRowActionText() {
  const { t } = useTranslation();
  return (
    key: keyof typeof rowActionMessages.en,
    params?: Record<string, string | number>,
  ) => t(key, params, rowActionMessages);
}
