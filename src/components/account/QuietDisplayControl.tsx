"use client";

import { useDisplayPreferences } from "@/components/providers/display-preferences-provider";
import { useTranslation } from "@/i18n";

export function QuietDisplayControl({
  compact = false,
}: {
  compact?: boolean;
}) {
  const { quiet, remembered, setQuiet } = useDisplayPreferences();
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
                ? "Oculta puntos, rachas y celebraciones en Inicio y Tareas. Las tareas y recompensas siguen funcionando. Se guarda para ti en este dispositivo."
                : "Hide points, streaks and celebrations on Home and Chores. Chores and rewards still work. Saved for you on this device."}
            </span>
          )}
        </span>
        <input
          type="checkbox"
          role="switch"
          checked={quiet}
          onChange={(event) => setQuiet(event.target.checked)}
          className="h-6 w-11 shrink-0 accent-[var(--accent-fill)]"
        />
      </label>
      {!remembered && (
        <p role="status" className="text-footnote text-label-secondary">
          {es
            ? "El almacenamiento está bloqueado. Tu elección dura esta visita."
            : "Storage is blocked. Your choice lasts for this visit."}
        </p>
      )}
    </div>
  );
}
