"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "@/i18n";
import { calendarFormMessages, type CalendarFormMessage } from "@/i18n/calendar-forms";
import { MEMBER_COLOR_CSS, isMemberColorKey } from "@/lib/member-colors";
import type { EventPerson, EventPersonRef } from "@/lib/event-participants";

const key = (ref: EventPersonRef) => `${ref.kind}:${ref.id}`;

function readPeople(body: unknown): EventPerson[] | null {
  if (!body || typeof body !== "object") return null;
  const { supported, people } = body as { supported?: unknown; people?: unknown };
  if (supported !== true || !Array.isArray(people)) return null;
  const out: EventPerson[] = [];
  for (const row of people) {
    if (!row || typeof row !== "object") return null;
    const { kind, id, name, color } = row as Record<string, unknown>;
    if ((kind !== "account" && kind !== "profile") || typeof id !== "string" || !id || typeof name !== "string" || !isMemberColorKey(color)) return null;
    out.push({ kind, id, name, color });
  }
  return new Set(out.map(key)).size === out.length ? out : null;
}

/**
 * "Who is it for?" on the event forms (people on events, default-off).
 *
 * Renders nothing unless the server says the capability is on and the
 * household has people to choose, and tells the form through
 * `onAvailability` whether a people list may be sent at all. A failed or
 * unsupported read is never treated as an empty household: the form then
 * leaves the event's people untouched.
 */
export function EventPeoplePicker({
  value,
  onChange,
  onAvailability,
  disabled = false,
}: {
  value: EventPersonRef[];
  onChange: (next: EventPersonRef[]) => void;
  onAvailability: (available: boolean) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const message = (name: CalendarFormMessage, params?: Record<string, string | number>) => t(name, params, calendarFormMessages);
  const [people, setPeople] = useState<EventPerson[] | null>(null);

  useEffect(() => {
    let retired = false;
    const controller = new AbortController();
    void (async () => {
      let found: EventPerson[] | null = null;
      try {
        const res = await fetch("/api/events/people", { signal: controller.signal, headers: { Accept: "application/json" } });
        if (res.ok) found = readPeople(await res.json());
      } catch {
        found = null;
      }
      if (retired) return;
      setPeople(found);
      onAvailability(found !== null);
    })();
    return () => {
      retired = true;
      controller.abort();
    };
    // The form's callback identity must not refetch the household.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!people || people.length === 0) return null;
  const chosen = new Set(value.map(key));
  const names = people.filter((person) => chosen.has(key(person))).map((person) => person.name);
  return (
    <fieldset data-testid="event-people" className="min-w-0">
      <legend className="label-apple">{message("peopleLegend")}</legend>
      <div className="flex flex-wrap gap-2">
        {people.map((person) => {
          const on = chosen.has(key(person));
          return (
            <button
              key={key(person)}
              type="button"
              aria-pressed={on}
              disabled={disabled}
              onClick={() =>
                onChange(on ? value.filter((ref) => key(ref) !== key(person)) : [...value, { kind: person.kind, id: person.id }])
              }
              className={`inline-flex min-h-[44px] max-w-full items-center gap-2 rounded-full border px-3.5 py-2 text-body [overflow-wrap:anywhere] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:opacity-50 ${
                on
                  ? "border-[var(--accent)] bg-[var(--accent-tint)] font-semibold text-label-primary"
                  : "border-[var(--surface-separator)] bg-[var(--surface-elevated)] text-label-primary"
              }`}
            >
              <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full" style={{ background: MEMBER_COLOR_CSS[person.color] }} />
              {person.name}
              {/* Selection is never colour-only: a visible mark and aria-pressed. */}
              <span aria-hidden="true" className="w-3 text-center">{on ? "✓" : ""}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-footnote text-label-secondary" role="status" aria-live="polite">
        {names.length ? message("peopleChosen", { names: names.join(", ") }) : message("peopleHint")}
      </p>
    </fieldset>
  );
}
