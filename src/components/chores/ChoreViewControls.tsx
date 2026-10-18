"use client";
import type { RefCallback } from "react";
import { useChoreOverviewText } from "@/i18n/chore-overview";
import { cn } from "@/lib/utils";

export type ChorePresentation =
  "today" | "week" | "series" | "all" | "routines";
export type ChoreRange = "today" | "week" | "all";

/** Primary work views, with history and the dedicated routine workspace nearby. */
export function ChoreViewControls({
  value,
  range,
  onChange,
  onRangeChange,
  todayRef,
}: {
  value: ChorePresentation;
  range: ChoreRange;
  onChange: (view: ChorePresentation) => void;
  onRangeChange: (range: ChoreRange) => void;
  todayRef?: RefCallback<HTMLButtonElement>;
}) {
  const text = useChoreOverviewText();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div
        role="group"
        aria-label={text("views")}
        className="flex max-w-full flex-wrap gap-1 rounded-xl bg-[var(--surface-fill)] p-1"
      >
        {(["today", "week", "series"] as const).map((view) => (
          <button
            key={view}
            type="button"
            ref={view === "today" ? todayRef : undefined}
            onClick={() => onChange(view)}
            aria-pressed={value === view}
            className={cn(
              "min-h-[44px] min-w-[44px] rounded-lg px-4 py-2 text-subhead font-semibold",
              value === view
                ? "bg-[var(--surface-elevated)] text-label-primary shadow-sm"
                : "text-label-secondary hover:text-label-primary",
            )}
          >
            {text(view)}
          </button>
        ))}
      </div>
      <label className="inline-flex min-h-[44px] max-w-full items-center">
        <span className="sr-only">{text("more")}</span>
        <select
          value={value === "all" || value === "routines" ? value : ""}
          onChange={(event) =>
            onChange(event.target.value as "all" | "routines")
          }
          className="min-h-[44px] max-w-full rounded-xl text-subhead"
        >
          <option value="" disabled>
            {text("chooseMore")}
          </option>
          <option value="all">{text("all")}</option>
          <option value="routines">{text("routines")}</option>
        </select>
      </label>
      {value === "routines" && (
        <label className="inline-flex min-h-[44px] max-w-full items-center">
          <span className="sr-only">{text("routineRange")}</span>
          <select
            value={range}
            onChange={(event) =>
              onRangeChange(event.target.value as ChoreRange)
            }
            className="min-h-[44px] max-w-full rounded-xl text-subhead"
          >
            {(["today", "week", "all"] as const).map((option) => (
              <option key={option} value={option}>
                {text(option)}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
