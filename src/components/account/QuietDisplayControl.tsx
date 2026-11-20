"use client";

import * as React from "react";
import { useDisplayPreferences } from "@/components/providers/display-preferences-provider";
import DisplayPreferencesStatus from "./DisplayPreferencesStatus";
import { useDisplayPreferencesText } from "@/i18n/display-preferences";
import { cn } from "@/lib/utils";

/**
 * The Quiet view switch. Built like the notification switches: the title
 * alone names the switch and the explanation describes it, so the switch is
 * announced (and found by tests) as "Quiet view", not as the whole paragraph.
 * The switch itself is a 44x44 target.
 */
export function QuietDisplayControl({
  compact = false,
}: {
  compact?: boolean;
}) {
  const { quiet, saving, syncState, setQuiet } = useDisplayPreferences();
  const text = useDisplayPreferencesText();
  const idBase = React.useId();
  const labelId = `${idBase}-label`;
  const descId = `${idBase}-desc`;
  return (
    <div className={compact ? "mb-4" : "card space-y-3"}>
      <div className="flex min-h-[44px] items-center justify-between gap-4">
        <div className="min-w-0">
          <p
            id={labelId}
            className="text-body font-semibold text-label-primary"
          >
            {text("quietTitle")}
          </p>
          {!compact && (
            <p id={descId} className="mt-1 text-subhead text-label-secondary">
              {text("quietDescription")}
            </p>
          )}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={quiet}
          aria-labelledby={labelId}
          aria-describedby={compact ? undefined : descId}
          disabled={saving || syncState !== "ready"}
          onClick={() => void setQuiet(!quiet)}
          className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center gap-2 rounded-full px-1 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-text)] disabled:opacity-60"
        >
          {/* The word says the state; colour is not the only cue. */}
          <span
            className="text-right text-[14px] font-medium text-label-secondary"
            aria-hidden="true"
          >
            {text(quiet ? "on" : "off")}
          </span>
          <span
            aria-hidden="true"
            className={cn(
              "relative inline-flex h-7 w-12 items-center rounded-full transition-colors motion-reduce:transition-none",
              quiet ? "bg-accent-fill" : "bg-[var(--label-tertiary)]",
            )}
          >
            <span
              className={cn(
                "inline-block h-5 w-5 rounded-full bg-white shadow transition-transform motion-reduce:transition-none",
                quiet ? "translate-x-6" : "translate-x-1",
              )}
            />
          </span>
        </button>
      </div>
      <DisplayPreferencesStatus />
    </div>
  );
}
