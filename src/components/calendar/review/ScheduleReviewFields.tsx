"use client";
import * as React from "react";
import { useScheduleReviewText } from "@/i18n/schedule-review";
import {
  formatScheduleInstant,
  scheduleWallChoices,
  type BufferDraft,
  type WindowDraft,
} from "@/lib/calendar-planning/schedule-form";
const input =
  "mt-1 min-h-11 w-full rounded-xl border border-[var(--surface-separator)] bg-[var(--surface-fill-secondary)] px-3 py-2 text-label-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)] disabled:opacity-50";
export function BufferFields({
  value,
  onChange,
  disabled,
}: {
  value: BufferDraft;
  onChange: (next: BufferDraft) => void;
  disabled: boolean;
}) {
  const copy = useScheduleReviewText();
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {(["preparation", "travelBefore", "travelAfter"] as const).map((key) => (
        <label className="min-w-0 text-footnote" key={key}>
          {copy[key]} · {copy.minutes}
          <input
            className={input}
            type="number"
            inputMode="numeric"
            min="0"
            max="240"
            step="1"
            value={value[key]}
            disabled={disabled}
            onChange={(event) =>
              onChange({ ...value, [key]: event.target.value })
            }
          />
        </label>
      ))}
    </div>
  );
}
export function WindowFields({
  value,
  zone,
  locale,
  onChange,
  disabled,
}: {
  value: WindowDraft;
  zone: string;
  locale: string;
  onChange: (next: WindowDraft) => void;
  disabled: boolean;
}) {
  const copy = useScheduleReviewText(),
    groupId = React.useId();
  return (
    <div className="space-y-3">
      {(["start", "end"] as const).map((key) => {
        const choices = scheduleWallChoices(value[key], zone),
          selected = key === "start" ? value.startChoice : value.endChoice;
        return (
          <div key={key}>
            <label className="block text-footnote">
              {copy[key]}
              <input
                className={input}
                type="datetime-local"
                step="1"
                value={value[key]}
                disabled={disabled}
                onChange={(event) =>
                  onChange({
                    ...value,
                    [key]: event.target.value,
                    [key === "start" ? "startChoice" : "endChoice"]: null,
                  })
                }
              />
            </label>
            {value[key] && choices.length === 0 && (
              <p role="status" className="mt-1 text-footnote">
                {copy.gap}
              </p>
            )}
            {choices.length > 1 && (
              <fieldset className="mt-2 space-y-1">
                <legend className="text-footnote">{copy.fold}</legend>
                {choices.map((choice) => (
                  <label
                    key={choice}
                    className="flex min-h-11 items-center gap-3 rounded-xl bg-[var(--surface-fill-secondary)] px-3"
                  >
                    <input
                      type="radio"
                      checked={choice === selected}
                      disabled={disabled}
                      name={`${groupId}-${key}`}
                      onChange={() =>
                        onChange({
                          ...value,
                          [key === "start" ? "startChoice" : "endChoice"]:
                            choice,
                        })
                      }
                    />
                    {formatScheduleInstant(choice, locale, zone)}
                  </label>
                ))}
              </fieldset>
            )}
          </div>
        );
      })}
    </div>
  );
}
