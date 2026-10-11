"use client";
import { useTranslation } from "@/i18n";
import {
  formatWeeklyDays,
  normalizedWeekdays,
  WEEKDAYS,
} from "@/lib/chore-weekdays";
import { choreScheduleMessages } from "@/i18n/chore-schedule";

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
  const { locale, t } = useTranslation();
  const localeCopy = choreScheduleMessages[locale];
  const labels = {
    legend: copy?.legend ?? localeCopy.weeklyLegend ?? defaultCopy.legend,
    hint: copy?.hint ?? localeCopy.weeklyHint ?? defaultCopy.hint,
    weekdays: copy?.weekdays ?? localeCopy.weekdayNames,
  };
  const selectedDays = normalizedWeekdays(days);
  const daySummary = formatWeeklyDays(selectedDays, locale);
  const summaryKey = "choreSchedule.weeklyDays";
  const summaryTemplate = localeCopy.weeklyDays;
  const translatedSummary = daySummary && t(summaryKey, { days: daySummary });
  // A picker can be rendered in a focused unit test without the app provider.
  // Keep that isolated surface readable while the real app uses typed i18n.
  const summary =
    daySummary &&
    (translatedSummary === summaryKey
      ? summaryTemplate.replace("{days}", daySummary)
      : translatedSummary);
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
      {summary && (
        <p
          className="text-footnote text-label-secondary"
          role="status"
          aria-live="polite"
          data-testid="weekly-schedule-summary"
        >
          {summary}
        </p>
      )}
    </fieldset>
  );
}
