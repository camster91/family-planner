"use client";
import * as React from "react";
import { calendarOwnerSchema, sameCalendarOwner, type CalendarReadOwner } from "@/lib/calendar-read-owner";
import { useCoreTranslation } from "@/i18n/core";
import { calendarPageMessages } from "@/i18n/calendar-page";

export type CalendarReadScope = {
  owner: CalendarReadOwner | null;
  held: boolean;
  admit: (owner: CalendarReadOwner) => boolean;
  hold: () => void;
};
/** One mounted read scope shared by range/source reads and the page shell.
 * Retirement is sticky. Only a deliberate document reload starts a new scope.
 * This is not a mutation receipt or a session credential. */
export function useCalendarReadScope(initialOwner?: CalendarReadOwner): CalendarReadScope {
  const [, redraw] = React.useReducer((n: number) => n + 1, 0);
  const bootstrapped = React.useRef(initialOwner !== undefined);
  const ref = React.useRef<CalendarReadScope | null>(null);
  if (!ref.current) {
    const parsed = calendarOwnerSchema.safeParse(initialOwner);
    const scope: CalendarReadScope = {
      owner: parsed.success ? Object.freeze(parsed.data) : null,
      held: initialOwner !== undefined && !parsed.success,
      hold() { if (!scope.held) { scope.held = true; redraw(); } },
      admit(owner) {
        if (scope.held) return false;
        if (scope.owner && !sameCalendarOwner(scope.owner, owner)) { scope.hold(); return false; }
        scope.owner ??= Object.freeze({ ...owner });
        return true;
      },
    };
    ref.current = scope;
  }
  // Server navigation/refresh may replace props while keeping this client
  // instance. Mask the old page in this render, before effects or a new fetch.
  if (bootstrapped.current || initialOwner !== undefined) {
    const parsed = calendarOwnerSchema.safeParse(initialOwner);
    if (!parsed.success || (ref.current.owner && !sameCalendarOwner(ref.current.owner, parsed.data)))
      ref.current.held = true;
    else ref.current.owner ??= Object.freeze(parsed.data);
    bootstrapped.current = true;
  }
  return ref.current;
}

export function CalendarReadHeld() {
  const { t } = useCoreTranslation();
  const alert = React.useRef<HTMLParagraphElement>(null);
  React.useEffect(() => { alert.current?.focus(); }, []);
  return <section className="p-4 space-y-3">
    <p role="alert" tabIndex={-1} ref={alert}>{t("ownerHeld", undefined, calendarPageMessages)}</p>
    <button type="button" className="btn-tinted min-h-[44px]" onClick={() => window.location.reload()}>
      {t("reloadCalendar", undefined, calendarPageMessages)}
    </button>
  </section>;
}
