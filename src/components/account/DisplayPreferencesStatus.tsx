"use client";
import { useDisplayPreferences } from "@/components/providers/display-preferences-provider";
import { useDisplayPreferencesText } from "@/i18n/display-preferences";
/** Honest read-cache and save states, shared by every personalization surface. */
export default function DisplayPreferencesStatus() {
  const { syncState, syncError, saving, remembered, refresh } =
    useDisplayPreferences();
  const text = useDisplayPreferencesText();
  if (syncState === "ready" && !syncError && remembered && !saving) return null;
  const message = text(saving ? "saving"
    : syncState === "loading" ? "loading"
      : syncState === "forbidden" ? "forbidden"
        : syncState === "unsupported" ? "unsupported"
          : syncError === "conflict" ? "conflict"
            : syncError || syncState === "error" ? "unknown" : "memory");
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
          {text("refresh")}
        </button>
      )}
    </div>
  );
}
