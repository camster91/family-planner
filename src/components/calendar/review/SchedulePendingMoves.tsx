"use client";
import * as React from "react";
import { useScheduleReviewText } from "@/i18n/schedule-review";
import {
  scheduleMoveCommand,
  type ScheduleReviewScope,
} from "@/lib/calendar-planning/conflict-review";
import { formatScheduleInstant } from "@/lib/calendar-planning/schedule-form";
import type { useScheduleReviewSession } from "./useScheduleReviewSession";
export const reviewControl =
  "min-h-11 rounded-xl px-4 py-2 text-callout font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] disabled:opacity-50";
export const reviewPlain = `${reviewControl} bg-[var(--surface-fill-secondary)] text-label-primary`;
export default function SchedulePendingMoves({
  session,
  initialScope,
  locale,
  onOpen,
  onReset,
}: {
  session: ReturnType<typeof useScheduleReviewSession>;
  initialScope: ScheduleReviewScope;
  locale: string;
  onOpen: (scope: ScheduleReviewScope) => void;
  onReset: () => void;
}) {
  const copy = useScheduleReviewText(),
    [forget, setForget] = React.useState<string | null>(null);
  if (!session.entries.length) return null;
  return (
    <section className="space-y-3 rounded-2xl border border-[var(--surface-separator)] p-4">
      <h3 className="font-semibold">{copy.pending}</h3>
      <p className="text-footnote text-label-secondary">{copy.pendingHint}</p>
      {session.entries.map((entry) => {
        const command = scheduleMoveCommand.parse(JSON.parse(entry.body)),
          scope = {
            targetId: command.target.id,
            range: command.range,
            timeZone: command.timeZone,
          },
          review = Object.hasOwn(session.reviews, entry.key)
            ? session.reviews[entry.key]
            : undefined;
        const format = (value: string) =>
          formatScheduleInstant(value, locale, command.timeZone);
        const other = JSON.stringify(scope) !== JSON.stringify(initialScope);
        return (
          <div
            className="space-y-2 border-t border-[var(--surface-separator)] pt-3"
            key={entry.key}
          >
            <p>
              {format(command.start)} – {format(command.end)}
            </p>
            <p className="text-footnote text-label-secondary">
              {copy.zone}: {command.timeZone}
            </p>
            {review && <p role="status">{copy.states[review.state]}</p>}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={reviewPlain}
                disabled={session.busy || session.storageError}
                onClick={() => session.check(entry)}
              >
                {copy.check}
              </button>
              {review?.canRetry && (
                <button
                  type="button"
                  className={reviewPlain}
                  disabled={session.busy || session.storageError}
                  onClick={() => session.retry(entry)}
                >
                  {copy.retry}
                </button>
              )}
              {other && (
                <button
                  type="button"
                  className={reviewPlain}
                  disabled={session.busy}
                  onClick={() => {
                    session.stop();
                    onOpen(scope);
                  }}
                >
                  {copy.openSaved}
                </button>
              )}
              <button
                type="button"
                className={reviewPlain}
                disabled={session.busy || session.storageError}
                onClick={() => setForget(entry.key)}
              >
                {copy.forget}
              </button>
            </div>
            {forget === entry.key && (
              <div className="space-y-2">
                <p>{copy.forgetHint}</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={reviewPlain}
                    disabled={session.busy}
                    onClick={() => setForget(null)}
                  >
                    {copy.cancel}
                  </button>
                  <button
                    type="button"
                    className={reviewPlain}
                    disabled={session.busy}
                    onClick={() => {
                      onReset();
                      setForget(null);
                      session.forget(entry);
                    }}
                  >
                    {copy.forgetConfirm}
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
