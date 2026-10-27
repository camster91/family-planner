"use client";

import { useDisplayPreferences } from "@/components/providers/display-preferences-provider";
import DisplayPreferencesStatus from "./DisplayPreferencesStatus";
import { useDisplayPreferencesText } from "@/i18n/display-preferences";

export function QuietDisplayControl({
  compact = false,
}: {
  compact?: boolean;
}) {
  const { quiet, saving, syncState, setQuiet } = useDisplayPreferences();
  const text = useDisplayPreferencesText();
  return (
    <div className={compact ? "mb-4" : "card space-y-3"}>
      <label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-4">
        <span className="min-w-0">
          <span className="block text-body font-semibold text-label-primary">
            {text("quietTitle")}
          </span>
          {!compact && (
            <span className="mt-1 block text-subhead text-label-secondary">
              {text("quietDescription")}
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
