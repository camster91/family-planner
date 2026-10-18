"use client";
import { useDisplayPreferences } from "@/components/providers/display-preferences-provider";
import { useTranslation } from "@/i18n";
/** Honest read-cache and save states, shared by every personalization surface. */
export default function DisplayPreferencesStatus() {
  const { syncState, syncError, saving, remembered, refresh } =
    useDisplayPreferences();
  const { locale } = useTranslation();
  const es = locale === "es";
  if (syncState === "ready" && !syncError && remembered && !saving) return null;
  const message = saving
    ? es
      ? "Guardando en tu cuenta…"
      : "Saving to your account…"
    : syncState === "loading"
      ? es
        ? "Cargando tus preferencias…"
        : "Loading your preferences…"
      : syncState === "forbidden"
        ? es
          ? "Cambió tu acceso. Inicia sesión de nuevo."
          : "Your access changed. Sign in again."
        : syncState === "unsupported"
          ? es
            ? "Este servidor todavía no admite preferencias de cuenta."
            : "This server does not support account preferences yet."
          : syncError === "conflict"
            ? es
              ? "Tus preferencias cambiaron en otro dispositivo. Actualiza antes de guardar. Tu borrador sigue aquí."
              : "Your preferences changed on another device. Refresh before saving. Your draft is still here."
            : syncError || syncState === "error"
              ? es
                ? "No se pudo confirmar el cambio. Actualiza para comprobar lo guardado antes de intentarlo otra vez."
                : "The change could not be confirmed. Refresh to check what was saved before trying again."
              : es
                ? "No se pudo guardar una copia sin conexión. Los cambios confirmados siguen guardados en tu cuenta."
                : "An offline copy could not be saved. Confirmed changes are still saved to your account.";
  return (
    <div
      role={syncError ? "alert" : "status"}
      className="space-y-2 text-footnote text-label-secondary"
    >
      <p>{message}</p>
      {!saving && syncState !== "loading" && syncState !== "forbidden" && (
        <button
          type="button"
          onClick={() => void refresh()}
          className="btn-tinted min-h-[44px]"
        >
          {es ? "Actualizar preferencias" : "Refresh preferences"}
        </button>
      )}
    </div>
  );
}
