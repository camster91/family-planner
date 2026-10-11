"use client";
import { WEEKDAYS } from "@/lib/chore-weekdays";

export type WeeklyDaysPickerCopy = {
  legend?: string;
  hint?: string;
  weekdays?: Partial<Record<number, string>>;
};

const defaultCopy: Required<Pick<WeeklyDaysPickerCopy, "legend" | "hint">> = {
  legend: "Repeat on",
  hint: "Choose one or more days each week.",
};

export function WeeklyDaysPicker({
  days,
  onChange,
  copy,
}: {
  days: number[];
  onChange: (days: number[]) => void;
  copy?: WeeklyDaysPickerCopy;
}) {
  const labels = { ...defaultCopy, ...copy };
  return (
    <fieldset className="space-y-2">
      <legend className="label-apple">{labels.legend}</legend>
      <p className="text-footnote text-label-secondary">{labels.hint}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {WEEKDAYS.map(({ day, label }) => (
          <label
            key={day}
            className="flex min-h-[44px] items-center gap-2 rounded-lg bg-[var(--surface-fill)] px-3 py-2 text-label-primary"
          >
            <input
              type="checkbox"
              checked={days.includes(day)}
              onChange={() =>
                onChange(
                  days.includes(day)
                    ? days.filter((d) => d !== day)
                    : [...days, day].sort((a, b) => a - b),
                )
              }
            />
            <span className="min-w-0 break-words">
              {labels.weekdays?.[day] ?? label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
