"use client";

import type { ReactNode, Ref } from "react";
import { useTranslation } from "@/i18n";
import {
  calendarFormMessages,
  type CalendarFormMessage,
} from "@/i18n/calendar-forms";

/** Keep optional fields mounted so folding never changes the event payload. */
export function EventFormDetails({
  children,
  description,
  location,
  end,
  sectionRef,
}: {
  children: ReactNode;
  description: string;
  location: string;
  end?: string;
  sectionRef: Ref<HTMLDetailsElement>;
}) {
  const { t, locale } = useTranslation();
  const message = (
    key: CalendarFormMessage,
    params?: Record<string, string | number>,
  ) => t(key, params, calendarFormMessages);
  const summary = [
    end
      ? message("endsAt", {
          time: new Intl.DateTimeFormat(locale, {
            dateStyle: "medium",
            timeStyle: "short",
          }).format(new Date(end)),
        })
      : null,
    location.trim() || null,
    description.trim() ? message("descriptionAdded") : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <details
      ref={sectionRef}
      data-testid="event-details-section"
      className="rounded-[var(--radius-lg)] border border-[var(--surface-separator)] bg-[var(--surface-elevated)]"
      onInvalidCapture={(event) => {
        event.currentTarget.open = true;
      }}
    >
      <summary className="min-h-[44px] cursor-pointer px-4 py-3 text-body text-label-primary [overflow-wrap:anywhere] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">
        <span className="font-semibold">{message("details")}</span>
        <span className="block text-footnote text-label-secondary mt-1">
          {summary || message("detailsHint")}
        </span>
      </summary>
      <div className="px-4 pb-4 space-y-5">{children}</div>
    </details>
  );
}
