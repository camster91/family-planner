"use client";
import { useTranslation } from "@/i18n";
import { useLocalNow } from "@/components/ui/use-hydrated";
import { formatDateOnly, parseDateOnly, toDateOnlyLocal } from "@/lib/dates";
import {
  formatWeeklyDays,
  nextSelectedWeekday,
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
  const labels = { ...defaultCopy, ...copy };
  const { locale, t } = useTranslation();
  const now = useLocalNow();
  const selectedDays = normalizedWeekdays(days);
  const today = now ? parseDateOnly(toDateOnlyLocal(now)) : null;
  const nextDate = today
    ? nextSelectedWeekday(today, selectedDays, true)
    : null;
  const daySummary = formatWeeklyDays(selectedDays, locale);
  const dateSummary = nextDate
    ? formatDateOnly(nextDate, undefined, locale === "es" ? "es-ES" : "en-CA")
    : null;
  const summaryKey = dateSummary
    ? "choreSchedule.weeklySummary"
    : "choreSchedule.weeklyDays";
  const summaryTemplate = dateSummary
    ? choreScheduleMessages[locale].weeklySummary
    : choreScheduleMessages[locale].weeklyDays;
  const translatedSummary =
    daySummary && t(summaryKey, { days: daySummary, date: dateSummary ?? "" });
  // A picker can be rendered in a focused unit test without the app provider.
  // Keep that isolated surface readable while the real app uses typed i18n.
  const summary =
    daySummary &&
    (translatedSummary === summaryKey
      ? summaryTemplate
          .replace("{days}", daySummary)
          .replace("{date}", dateSummary ?? "")
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
