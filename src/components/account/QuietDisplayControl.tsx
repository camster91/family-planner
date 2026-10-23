"use client";

import { useDisplayPreferences } from "@/components/providers/display-preferences-provider";
import DisplayPreferencesStatus from "./DisplayPreferencesStatus";
import { useTranslation } from "@/i18n";

export function QuietDisplayControl({
  compact = false,
}: {
  compact?: boolean;
}) {
  const { quiet, saving, syncState, setQuiet } = useDisplayPreferences();
  const { locale } = useTranslation();
  const es = locale === "es";
  const title = es ? "Vista tranquila" : "Quiet view";
  return (
    <div className={compact ? "mb-4" : "card space-y-3"}>
      <label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-4">
        <span className="min-w-0">
          <span className="block text-body font-semibold text-label-primary">
            {title}
          </span>
          {!compact && (
            <span className="mt-1 block text-subhead text-label-secondary">
              {es
                ? "Oculta puntos, rachas y celebraciones en Inicio y Tareas. Las tareas y recompensas siguen funcionando. Se guarda en tu cuenta para todos tus dispositivos."
                : "Hide points, streaks and celebrations on Home and Chores. Chores and rewards still work. Saved to your account across devices."}
            </span>
          )}
        </span>
        <input
          type="checkbox"
          role="switch"
          disabled={saving || syncState !== "ready"}
          checked={quiet}
          onChange={(event) => void setQuiet(event.target.checked)}
          className="h-6 w-11 shrink-0 accent-[var(--accent-fill)]"
        />
      </label>
      <DisplayPreferencesStatus />
    </div>
  );
}
