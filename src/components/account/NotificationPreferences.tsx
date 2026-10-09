"use client";

// Per-member notification switches (#286, PR101 D-5). Used by the Settings
// "Notifications" section (parents and teens, O-37) and by the user-menu
// dialog (children, who cannot open Settings; src/lib/kid-access.ts).
//
// Each switch saves on its own: the change shows at once, and goes back with a
// message if the save fails. Offline, the switches are disabled with a notice.
//
// Quiet hours (#141, O-32): a switch plus "From"/"Until" times. Notifications
// still arrive in the list during quiet hours; they just must not interrupt.
// The times are saved with this browser's time zone (O-31: dates use the
// browser's local time).
//
// Morning summary (O-40): an opt-in switch (default off), also saved with this
// browser's time zone. It arrives only if the operator has scheduled it.

import * as React from "react";
import { newIdempotencyKey, IDEMPOTENCY_HEADER } from "@/lib/idempotency-key";
import { useOnline } from "@/components/ui/use-online";
import { cn } from "@/lib/utils";
import {
  DEFAULT_MORNING_SUMMARY,
  NOTIFICATION_CATEGORIES,
  type MorningSummaryPreference,
  type NotificationCategory,
  type NotificationPreferences as Prefs,
} from "@/lib/notification-policy";
import { isClockTime } from "@/lib/ambient";
import {
  DEFAULT_QUIET_HOURS,
  quietHoursProblem,
  type QuietHours,
} from "@/lib/quiet-hours";
import {
  NotificationPreferencesLoading,
  NotificationPreferencesFailure,
} from "./NotificationPreferencesStatus";

import { useTranslation } from "@/i18n";
import {
  notificationPreferencesMessages,
  type NotificationPreferencesMessage,
} from "@/i18n/notification-preferences";

const ENDPOINT = "/api/users/preferences";
type Feedback =
  | {
      kind: "saved" | "error";
      subject: "category";
      category: NotificationCategory;
      enabled: boolean;
    }
  | { kind: "saved" | "error"; subject: "summary"; enabled: boolean }
  | { kind: "saved" | "error"; subject: "quiet"; value: QuietHours };

type Load =
  | { state: "loading" }
  | { state: "error" }
  | {
      state: "ready";
      prefs: Prefs;
      quiet: QuietHours;
      summary: MorningSummaryPreference;
    };

function isMorningSummary(value: unknown): value is MorningSummaryPreference {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.enabled === "boolean" &&
    (v.timeZone === null || typeof v.timeZone === "string")
  );
}

function isPrefs(value: unknown): value is Prefs {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return NOTIFICATION_CATEGORIES.every((c) => typeof v[c] === "boolean");
}

function isQuietHours(value: unknown): value is QuietHours {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.enabled === "boolean" &&
    isClockTime(v.start) &&
    isClockTime(v.end) &&
    (v.timeZone === null || typeof v.timeZone === "string")
  );
}

/**
 * "22:00" → "10:00 PM" (in this browser's locale), so the saved message reads
 * like the time boxes above it instead of switching to a 24-hour clock.
 */
export function formatClock(hhmm: string, locale?: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  try {
    return new Date(2000, 0, 1, Number(m[1]), Number(m[2]))
      .toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" })
      .replace(/[\u202f\u00a0]/g, " ");
  } catch {
    return hhmm;
  }
}

/** This browser's IANA time zone, or null when the browser does not say. */
function browserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

export default function NotificationPreferences({
  className,
}: {
  className?: string;
}) {
  const { t, locale } = useTranslation();
  const msg = (
    key: NotificationPreferencesMessage,
    params?: Record<string, string | number>,
  ) => t(key, params, notificationPreferencesMessages);
  const online = useOnline();
  const [load, setLoad] = React.useState<Load>({ state: "loading" });
  const [saving, setSaving] = React.useState<
    Partial<Record<NotificationCategory, boolean>>
  >({});
  const [status, setStatus] = React.useState<Feedback | null>(null);
  const [quietDraft, setQuietDraft] = React.useState({
    start: DEFAULT_QUIET_HOURS.start,
    end: DEFAULT_QUIET_HOURS.end,
  });
  const [quietSaving, setQuietSaving] = React.useState(false);
  const [summarySaving, setSummarySaving] = React.useState(false);
  const [quietError, setQuietError] = React.useState<string | null>(null);
  const [timeZone, setTimeZone] = React.useState<string | null>(null);
  const idBase = React.useId();

  // Read after mount so the server render and the first client render match.
  React.useEffect(() => {
    setTimeZone(browserTimeZone());
  }, []);

  const fetchPrefs = React.useCallback(async () => {
    setLoad({ state: "loading" });
    try {
      const res = await fetch(ENDPOINT, { cache: "no-store" });
      const body = res.ok ? await res.json() : null;
      if (!isPrefs(body?.preferences)) throw new Error("bad response");
      const quiet = isQuietHours(body?.quietHours)
        ? body.quietHours
        : DEFAULT_QUIET_HOURS;
      // An older server without the morning summary reads as off.
      const summary = isMorningSummary(body?.morningSummary)
        ? body.morningSummary
        : DEFAULT_MORNING_SUMMARY;
      setLoad({ state: "ready", prefs: body.preferences, quiet, summary });
      setQuietDraft({ start: quiet.start, end: quiet.end });
    } catch {
      setLoad({ state: "error" });
    }
  }, []);

  React.useEffect(() => {
    void fetchPrefs();
  }, [fetchPrefs]);

  const toggle = async (category: NotificationCategory) => {
    if (load.state !== "ready" || saving[category] || !online) return;
    const previous = load.prefs[category];
    const next = !previous;
    // Optimistic: flip now, put it back if the save fails.
    setLoad((l) =>
      l.state === "ready"
        ? { ...l, prefs: { ...l.prefs, [category]: next } }
        : l,
    );
    setSaving((s) => ({ ...s, [category]: true }));
    setStatus(null);
    try {
      const res = await fetch(ENDPOINT, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          [IDEMPOTENCY_HEADER]: newIdempotencyKey(),
        },
        body: JSON.stringify({ [category]: next }),
      });
      const body = res.ok ? await res.json() : null;
      if (!isPrefs(body?.preferences)) throw new Error("save failed");
      // Take only this switch from the answer, so a save still running for
      // another switch is not overwritten by this response.
      const saved = body.preferences[category];
      setLoad((l) =>
        l.state === "ready"
          ? { ...l, prefs: { ...l.prefs, [category]: saved } }
          : l,
      );
      setStatus({
        kind: "saved",
        subject: "category",
        category,
        enabled: saved,
      });
    } catch {
      setLoad((l) =>
        l.state === "ready"
          ? { ...l, prefs: { ...l.prefs, [category]: previous } }
          : l,
      );
      setStatus({
        kind: "error",
        subject: "category",
        category,
        enabled: previous,
      });
    } finally {
      setSaving((s) => ({ ...s, [category]: false }));
    }
  };

  // Morning summary (O-40): opt-in, saved with this browser's time zone so
  // "today" and event times match this device's clock (O-31).
  const toggleSummary = async () => {
    if (load.state !== "ready" || summarySaving || !online) return;
    const previous = load.summary;
    const next: MorningSummaryPreference = {
      enabled: !previous.enabled,
      timeZone: browserTimeZone(),
    };
    setLoad((l) => (l.state === "ready" ? { ...l, summary: next } : l));
    setSummarySaving(true);
    setStatus(null);
    try {
      const res = await fetch(ENDPOINT, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          [IDEMPOTENCY_HEADER]: newIdempotencyKey(),
        },
        body: JSON.stringify({ morningSummary: next }),
      });
      const body = res.ok ? await res.json() : null;
      if (!isMorningSummary(body?.morningSummary))
        throw new Error("save failed");
      const saved: MorningSummaryPreference = body.morningSummary;
      setLoad((l) => (l.state === "ready" ? { ...l, summary: saved } : l));
      setStatus({ kind: "saved", subject: "summary", enabled: saved.enabled });
    } catch {
      setLoad((l) => (l.state === "ready" ? { ...l, summary: previous } : l));
      setStatus({
        kind: "error",
        subject: "summary",
        enabled: previous.enabled,
      });
    } finally {
      setSummarySaving(false);
    }
  };

  // Saves the whole quiet-hours setting: `enabled` plus the times in the
  // boxes, in this browser's time zone. Goes back with a message on failure.
  const saveQuiet = async (enabled: boolean) => {
    if (load.state !== "ready" || quietSaving || !online) return;
    const problem = quietHoursProblem(quietDraft.start, quietDraft.end);
    if (problem) {
      setQuietError(problem);
      return;
    }
    setQuietError(null);
    const previous = load.quiet;
    const next: QuietHours = {
      enabled,
      start: quietDraft.start,
      end: quietDraft.end,
      timeZone: browserTimeZone(),
    };
    setLoad((l) => (l.state === "ready" ? { ...l, quiet: next } : l));
    setQuietSaving(true);
    setStatus(null);
    try {
      const res = await fetch(ENDPOINT, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          [IDEMPOTENCY_HEADER]: newIdempotencyKey(),
        },
        body: JSON.stringify({ quietHours: next }),
      });
      const body = res.ok ? await res.json() : null;
      if (!isQuietHours(body?.quietHours)) throw new Error("save failed");
      const saved: QuietHours = body.quietHours;
      setLoad((l) => (l.state === "ready" ? { ...l, quiet: saved } : l));
      setQuietDraft({ start: saved.start, end: saved.end });
      setStatus({
        kind: "saved",
        subject: "quiet",
        value: saved,
      });
    } catch {
      setLoad((l) => (l.state === "ready" ? { ...l, quiet: previous } : l));
      setStatus({
        kind: "error",
        subject: "quiet",
        value: previous,
      });
    } finally {
      setQuietSaving(false);
    }
  };

  const quietDirty =
    load.state === "ready" &&
    (quietDraft.start !== load.quiet.start ||
      quietDraft.end !== load.quiet.end);

  const feedbackText = !status
    ? ""
    : status.subject === "quiet"
      ? status.kind === "error"
        ? msg("quietFailed", {
            state: msg(status.value.enabled ? "onState" : "offState"),
          })
        : status.value.enabled
          ? msg("quietSavedOn", {
              start: formatClock(status.value.start, locale),
              end: formatClock(status.value.end, locale),
            })
          : msg("quietSavedOff")
      : msg(status.kind === "error" ? "failed" : "saved", {
          label: msg(
            status.subject === "category"
              ? `${status.category}Label`
              : "summaryLabel",
          ),
          state: msg(status.enabled ? "onState" : "offState"),
        });

  return (
    <div className={className} data-testid="notification-preferences">
      {!online && (
        <p
          role="status"
          className="mb-3 rounded-[var(--radius-md)] bg-[var(--surface-fill)] px-3 py-2 text-[15px] text-label-primary"
        >
          {msg("offline")}
        </p>
      )}

      {load.state === "loading" && <NotificationPreferencesLoading />}

      {load.state === "error" && (
        <NotificationPreferencesFailure onRetry={() => void fetchPrefs()} />
      )}

      {load.state === "ready" && (
        <ul className="divide-y divide-[var(--surface-separator)]">
          {NOTIFICATION_CATEGORIES.map((category) => {
            const on = load.prefs[category];
            const labelId = `${idBase}-${category}-label`;
            const descId = `${idBase}-${category}-desc`;
            return (
              <li
                key={category}
                className="flex items-center justify-between gap-4 py-3"
              >
                <div className="min-w-0">
                  <p
                    id={labelId}
                    className="text-[16px] font-medium text-label-primary"
                  >
                    {msg(`${category}Label`)}
                  </p>
                  <p
                    id={descId}
                    className="text-[14px] leading-snug text-label-secondary"
                  >
                    {msg(`${category}Description`)}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-labelledby={labelId}
                  aria-describedby={descId}
                  aria-busy={saving[category] ? true : undefined}
                  disabled={!online || saving[category]}
                  onClick={() => void toggle(category)}
                  className="group inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center gap-2 rounded-full px-1 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-text)] disabled:opacity-60"
                >
                  {/* The word says the state; colour is not the only cue. */}
                  <span
                    className="w-7 text-right text-[14px] font-medium text-label-secondary"
                    aria-hidden="true"
                  >
                    {msg(on ? "on" : "off")}
                  </span>
                  <span
                    aria-hidden="true"
                    className={cn(
                      "relative inline-flex h-7 w-12 items-center rounded-full transition-colors motion-reduce:transition-none",
                      on ? "bg-accent-fill" : "bg-[var(--label-tertiary)]",
                    )}
                  >
                    <span
                      className={cn(
                        "inline-block h-5 w-5 rounded-full bg-white shadow transition-transform motion-reduce:transition-none",
                        on ? "translate-x-6" : "translate-x-1",
                      )}
                    />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {load.state === "ready" && (
        <div
          className="flex items-center justify-between gap-4 border-t border-[var(--surface-separator)] py-3"
          data-testid="morning-summary"
        >
          <div className="min-w-0">
            <p
              id={`${idBase}-summary-label`}
              className="text-[16px] font-medium text-label-primary"
            >
              {msg("summaryLabel")}
            </p>
            <p
              id={`${idBase}-summary-desc`}
              className="text-[14px] leading-snug text-label-secondary"
            >
              {msg("summaryDescription")}{" "}
              {msg(load.summary.enabled ? "summaryOn" : "summaryOff")}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={load.summary.enabled}
            aria-labelledby={`${idBase}-summary-label`}
            aria-describedby={`${idBase}-summary-desc`}
            aria-busy={summarySaving ? true : undefined}
            disabled={!online || summarySaving}
            onClick={() => void toggleSummary()}
            className="group inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center gap-2 rounded-full px-1 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-text)] disabled:opacity-60"
          >
            <span
              className="w-7 text-right text-[14px] font-medium text-label-secondary"
              aria-hidden="true"
            >
              {msg(load.summary.enabled ? "on" : "off")}
            </span>
            <span
              aria-hidden="true"
              className={cn(
                "relative inline-flex h-7 w-12 items-center rounded-full transition-colors motion-reduce:transition-none",
                load.summary.enabled
                  ? "bg-accent-fill"
                  : "bg-[var(--label-tertiary)]",
              )}
            >
              <span
                className={cn(
                  "inline-block h-5 w-5 rounded-full bg-white shadow transition-transform motion-reduce:transition-none",
                  load.summary.enabled ? "translate-x-6" : "translate-x-1",
                )}
              />
            </span>
          </button>
        </div>
      )}

      {load.state === "ready" && (
        <fieldset
          className="mt-2 border-t border-[var(--surface-separator)] pt-3"
          data-testid="quiet-hours"
        >
          <legend className="sr-only">{msg("quiet")}</legend>
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p
                id={`${idBase}-quiet-label`}
                className="text-[16px] font-medium text-label-primary"
              >
                {msg("quiet")}
              </p>
              <p
                id={`${idBase}-quiet-desc`}
                className="text-[14px] leading-snug text-label-secondary"
              >
                {msg("quietDescription")}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={load.quiet.enabled}
              aria-labelledby={`${idBase}-quiet-label`}
              aria-describedby={`${idBase}-quiet-desc`}
              aria-busy={quietSaving ? true : undefined}
              disabled={!online || quietSaving}
              onClick={() => void saveQuiet(!load.quiet.enabled)}
              className="group inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center gap-2 rounded-full px-1 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-text)] disabled:opacity-60"
            >
              <span
                className="w-7 text-right text-[14px] font-medium text-label-secondary"
                aria-hidden="true"
              >
                {msg(load.quiet.enabled ? "on" : "off")}
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  "relative inline-flex h-7 w-12 items-center rounded-full transition-colors motion-reduce:transition-none",
                  load.quiet.enabled
                    ? "bg-accent-fill"
                    : "bg-[var(--label-tertiary)]",
                )}
              >
                <span
                  className={cn(
                    "inline-block h-5 w-5 rounded-full bg-white shadow transition-transform motion-reduce:transition-none",
                    load.quiet.enabled ? "translate-x-6" : "translate-x-1",
                  )}
                />
              </span>
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-end gap-3">
            {(["start", "end"] as const).map((edge) => (
              <label
                key={edge}
                className="flex flex-col text-[14px] text-label-secondary"
              >
                {msg(edge === "start" ? "quietFrom" : "quietUntil")}
                <input
                  type="time"
                  value={quietDraft[edge]}
                  required
                  disabled={!online || quietSaving}
                  aria-invalid={quietError ? true : undefined}
                  aria-describedby={
                    quietError
                      ? `${idBase}-quiet-error`
                      : `${idBase}-quiet-zone`
                  }
                  onChange={(e) => {
                    setQuietError(null);
                    setQuietDraft((d) => ({ ...d, [edge]: e.target.value }));
                  }}
                  className="mt-1 min-h-[44px] rounded-[var(--radius-md)] border border-[var(--surface-separator)] bg-[var(--surface-fill)] px-3 text-[16px] text-label-primary focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-text)] disabled:opacity-60"
                />
              </label>
            ))}
            <button
              type="button"
              disabled={!online || quietSaving || !quietDirty}
              onClick={() => void saveQuiet(load.quiet.enabled)}
              className="inline-flex min-h-[44px] items-center rounded-full bg-[var(--surface-fill)] px-4 text-[15px] font-medium text-label-primary focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-text)] disabled:opacity-60"
            >
              {msg("saveTimes")}
            </button>
          </div>
          {quietError ? (
            <p
              id={`${idBase}-quiet-error`}
              role="alert"
              className="pt-2 text-[14px] text-danger-text"
            >
              {quietError === "Choose both a start and an end time."
                ? msg("chooseTimes")
                : quietError === "The start and end times must be different."
                  ? msg("differentTimes")
                  : quietError}
            </p>
          ) : (
            <p
              id={`${idBase}-quiet-zone`}
              className="pt-2 text-[14px] leading-snug text-label-secondary"
            >
              {msg("zoneHint", { zone: timeZone ? ` (${timeZone})` : "" })}
            </p>
          )}
        </fieldset>
      )}

      <p aria-live="polite" className="min-h-[1.5em] pt-2 text-[14px]">
        {status && (
          <span
            className={
              status.kind === "error"
                ? "text-danger-text"
                : "text-label-secondary"
            }
          >
            {feedbackText}
          </span>
        )}
      </p>

      <p className="text-[14px] leading-snug text-label-secondary">
        {msg("always")}
      </p>
    </div>
  );
}
