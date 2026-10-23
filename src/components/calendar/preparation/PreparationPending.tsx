"use client";
import * as React from "react";
import { preparationCommand } from "@/lib/event-preparation/contract";
import { usePreparationText } from "@/i18n/event-preparation";
import type { usePreparationSession } from "./usePreparationSession";
import type { PreparationLocation } from "./PreparationProvider";
import { prepPlain } from "./PreparationPicker";
export default function PreparationPending({
  session,
  location,
  onOpen,
}: {
  session: ReturnType<typeof usePreparationSession>;
  location: PreparationLocation;
  onOpen: (location: PreparationLocation) => void;
}) {
  const copy = usePreparationText(),
    [forget, setForget] = React.useState<string | null>(null);
  if (!session.entries.length) return null;
  const states = {
    ready: copy.retry,
    pending: copy.pending,
    committed: copy.proof,
    expired: copy.expired,
    conflict: copy.changed,
    paused: copy.paused,
    unavailable: copy.error,
  };
  return (
    <section className="space-y-3 rounded-2xl border border-[var(--surface-separator)] p-4">
      <h3 className="font-semibold">{copy.pending}</h3>
      {session.entries.map((entry) => {
        const command = preparationCommand.parse(JSON.parse(entry.body)),
          review = session.reviews[entry.key];
        const other =
          command.eventId !== location.eventId ||
          command.timeZone !== location.timeZone;
        return (
          <div key={entry.key} className="space-y-3">
            <p>
              {command.action === "reuse-routine" ? copy.routine : copy.steps} ·{" "}
              {command.steps.length}
            </p>
            {review && <p role="status">{states[review.state]}</p>}
            {other && <p>{copy.savedElsewhere}</p>}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={prepPlain}
                disabled={session.busy || session.storageError}
                onClick={() => session.check(entry)}
              >
                {copy.check}
              </button>
              {review?.canRetry && (
                <button
                  type="button"
                  className={prepPlain}
                  disabled={session.busy || session.storageError}
                  onClick={() => session.retry(entry)}
                >
                  {copy.retry}
                </button>
              )}
              {other && (
                <button
                  type="button"
                  className={prepPlain}
                  disabled={session.busy}
                  onClick={() => {
                    session.stop();
                    onOpen({
                      eventId: command.eventId,
                      timeZone: command.timeZone,
                    });
                  }}
                >
                  {copy.open}
                </button>
              )}
              <button
                type="button"
                className={prepPlain}
                disabled={session.busy || session.storageError}
                onClick={() => setForget(entry.key)}
              >
                {copy.forget}
              </button>
            </div>
            {forget === entry.key && (
              <div className="space-y-2">
                <p>{copy.forgetHint}</p>
                <button
                  type="button"
                  className={prepPlain}
                  disabled={session.busy}
                  onClick={() => {
                    setForget(null);
                    session.forget(entry);
                  }}
                >
                  {copy.confirmForget}
                </button>
                <button
                  type="button"
                  className={prepPlain}
                  onClick={() => setForget(null)}
                >
                  {copy.cancel}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
