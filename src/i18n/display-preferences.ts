"use client";
import { useCallback } from "react";
import { useCoreTranslation } from "@/i18n/core";
const en = {
  saving: "Saving to your account…",
  loading: "Loading your preferences…",
  forbidden: "Your access changed. Sign in again.",
  unsupported: "This server does not support account preferences yet.",
  conflict: "Your preferences changed on another device. Refresh before saving. Your draft is still here.",
  unknown: "The change could not be confirmed. Refresh to check what was saved before trying again.",
  memory: "An offline copy could not be saved. Confirmed changes are still saved to your account.",
  refresh: "Refresh preferences",
  quietTitle: "Quiet view",
  quietDescription: "Hide points, streaks and celebrations on Home and Chores. Chores and rewards still work. Saved to your account across devices.",
};
const es: Record<keyof typeof en, string> = {
  saving: "Guardando en tu cuenta…",
  loading: "Cargando tus preferencias…",
  forbidden: "Cambió tu acceso. Inicia sesión de nuevo.",
  unsupported: "Este servidor todavía no admite preferencias de cuenta.",
  conflict: "Tus preferencias cambiaron en otro dispositivo. Actualiza antes de guardar. Tu borrador sigue aquí.",
  unknown: "No se pudo confirmar el cambio. Actualiza para comprobar lo guardado antes de intentarlo otra vez.",
  memory: "No se pudo guardar una copia sin conexión. Los cambios confirmados siguen guardados en tu cuenta.",
  refresh: "Actualizar preferencias",
  quietTitle: "Vista tranquila",
  quietDescription: "Oculta puntos, rachas y celebraciones en Inicio y Tareas. Las tareas y recompensas siguen funcionando. Se guarda en tu cuenta para todos tus dispositivos.",
};
const messages = { en, es };
export function useDisplayPreferencesText() {
  const { t } = useCoreTranslation();
  return useCallback((key: keyof typeof en) => t(key, undefined, messages), [t]);
}
