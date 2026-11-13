"use client";

import { useTranslation } from "@/i18n";
import { calendarFormMessages, type CalendarFormMessage } from "@/i18n/calendar-forms";
import { EVENT_REPEAT_EVERY, type EventRepeatEvery } from "@/lib/event-series";

export type EventRepeatValue = { every: "" | EventRepeatEvery; until: string };
export const NO_REPEAT: EventRepeatValue = { every: "", until: "" };

const LABEL: Record<EventRepeatEvery, CalendarFormMessage> = {
  day: "repeatDay", week: "repeatWeek", "2weeks": "repeat2Weeks", month: "repeatMonth", year: "repeatYear",
};

/** What the form sends for a chosen repeat; null when the event does not repeat. */
export function repeatRequest(value: EventRepeatValue) {
  if (value.every === "") return null;
  return { every: value.every, until: value.until || null, time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone };
}

/**
 * "Repeat" on the event forms (repeating events, default-off): a closed list
 * of repeats and an optional last day. The form mounts this only when the
 * server says the capability is on.
 */
export function EventRepeatField({
  value,
  onChange,
  startDate,
  disabled = false,
}: {
  value: EventRepeatValue;
  onChange: (next: EventRepeatValue) => void;
  /** The event's start day (YYYY-MM-DD); the last day cannot be before it. */
  startDate: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const message = (name: CalendarFormMessage) => t(name, undefined, calendarFormMessages);
  return (
    <div data-testid="event-repeat" className="space-y-3">
      <div>
        <label className="label-apple" htmlFor="eventRepeat">{message("repeatLabel")}</label>
        <select
          id="eventRepeat"
          className="input-apple min-h-[44px]"
          value={value.every}
          disabled={disabled}
          onChange={(e) => {
            const every = e.target.value as EventRepeatValue["every"];
            onChange(every === "" ? NO_REPEAT : { every, until: value.until });
          }}
        >
          <option value="">{message("repeatNone")}</option>
          {EVENT_REPEAT_EVERY.map((every) => (
            <option key={every} value={every}>{message(LABEL[every])}</option>
          ))}
        </select>
      </div>
      {value.every !== "" && (
        <div>
          <label className="label-apple" htmlFor="eventRepeatUntil">{message("repeatUntil")}</label>
          <input
            id="eventRepeatUntil"
            type="date"
            className="input-apple"
            value={value.until}
            min={startDate || undefined}
            disabled={disabled}
            aria-describedby="eventRepeatUntilHint"
            onChange={(e) => onChange({ every: value.every, until: e.target.value })}
          />
          <p id="eventRepeatUntilHint" className="mt-1 text-footnote text-label-secondary">{message("repeatUntilHint")}</p>
        </div>
      )}
    </div>
  );
}
