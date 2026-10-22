"use client";
import * as React from "react";
import { captureReviewInstant } from "@/lib/capture-document";
import type {
  CaptureEditableDocument,
  CaptureEditableRow,
} from "@/lib/capture-document";
import { useDisplayLocale } from "@/components/ui/use-display-locale";
import { useCaptureDraftText } from "@/i18n/capture-drafts";
const types = [
  "school",
  "sports",
  "appointment",
  "family",
  "work",
  "other",
] as const;
export function CaptureDraftFields({
  value,
  onChange,
  disabled,
  parent,
  focusClientId,
}: {
  value: CaptureEditableDocument;
  onChange: (value: CaptureEditableDocument) => void;
  disabled: boolean;
  parent: boolean;
  focusClientId?: string | null;
}) {
  const text = useCaptureDraftText(),
    id = React.useId(),
    locale = useDisplayLocale();
  const [offset, setOffset] = React.useState(0);
  const focused = React.useRef<string | null>(null);
  const focusedIndex = value.rows.findIndex(
    (row) => row.clientId === focusClientId,
  );
  React.useEffect(() => {
    if (focusedIndex >= 0) setOffset(Math.floor(focusedIndex / 5) * 5);
  }, [focusClientId, focusedIndex]);
  React.useEffect(() => {
    if (!disabled && focusClientId && focused.current !== focusClientId) {
      const input = document.getElementById(
        `${id}-${encodeURIComponent(focusClientId)}-title`,
      );
      if (input instanceof HTMLInputElement) {
        input.focus();
        focused.current = focusClientId;
      }
    }
  }, [disabled, focusClientId, id, offset]);

  React.useEffect(() => {
    setOffset((current) =>
      Math.min(
        current,
        Math.max(0, Math.floor((value.rows.length - 1) / 5) * 5),
      ),
    );
  }, [value.rows.length]);
  function starts(value: string) {
    try {
      return new Date(captureReviewInstant(value)).toLocaleString(locale);
    } catch {
      return text.start;
    }
  }
  function patch(row: CaptureEditableRow, fields: Partial<CaptureEditableRow>) {
    onChange({
      ...value,
      rows: value.rows.map((current) =>
        current.clientId === row.clientId ? { ...current, ...fields } : current,
      ),
    });
  }
  return (
    <fieldset disabled={disabled} className="space-y-4">
      {value.rows.slice(offset, offset + 5).map((row, index) => {
        const key = `${id}-${encodeURIComponent(row.clientId)}`;
        return (
          <fieldset
            key={row.clientId}
            className="space-y-3 rounded-2xl border border-[var(--surface-separator)] p-3"
          >
            <legend className="px-1 text-headline">
              {row.kind === "task" ? text.task : `${offset + index + 1}`}
            </legend>
            <label htmlFor={`${key}-title`} className="block text-subhead">
              {text.editTitle}
              <input
                id={`${key}-title`}
                value={row.title}
                maxLength={500}
                className="input-apple mt-1 min-h-11 w-full"
                onChange={(event) => patch(row, { title: event.target.value })}
              />
            </label>
            {row.kind === "event" && (
              <details>
                <summary className="min-h-11 cursor-pointer content-center text-subhead">
                  {starts(row.startTime)}
                </summary>
                <p className="mt-2 text-footnote text-label-secondary">
                  {text.timeHint}
                </p>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <label htmlFor={`${key}-start`} className="text-subhead">
                    {text.start}
                    <input
                      id={`${key}-start`}
                      type="text"
                      value={row.startTime}
                      maxLength={80}
                      placeholder="YYYY-MM-DDThh:mm"
                      className="input-apple mt-1 min-h-11 w-full"
                      onChange={(event) =>
                        patch(row, { startTime: event.target.value })
                      }
                    />
                  </label>
                  <label htmlFor={`${key}-end`} className="text-subhead">
                    {text.end}
                    <input
                      id={`${key}-end`}
                      type="text"
                      value={row.endTime}
                      maxLength={80}
                      placeholder="YYYY-MM-DDThh:mm"
                      className="input-apple mt-1 min-h-11 w-full"
                      onChange={(event) =>
                        patch(row, { endTime: event.target.value })
                      }
                    />
                  </label>
                  <label htmlFor={`${key}-location`} className="text-subhead">
                    {text.location}
                    <input
                      id={`${key}-location`}
                      value={row.location}
                      maxLength={500}
                      className="input-apple mt-1 min-h-11 w-full"
                      onChange={(event) =>
                        patch(row, { location: event.target.value })
                      }
                    />
                  </label>
                  <label htmlFor={`${key}-type`} className="text-subhead">
                    {text.eventType}
                    <select
                      id={`${key}-type`}
                      value={row.eventType}
                      className="input-apple mt-1 min-h-11 w-full"
                      onChange={(event) =>
                        patch(row, { eventType: event.target.value })
                      }
                    >
                      {!types.some((type) => type === row.eventType) && (
                        <option value={row.eventType}>
                          {text.unknownType}
                        </option>
                      )}
                      {types.map((type) => (
                        <option key={type} value={type}>
                          {text[type]}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </details>
            )}
            {row.kind === "listitem" && (
              <>
                <label
                  htmlFor={`${key}-quantity`}
                  className="block text-subhead"
                >
                  {text.quantity}
                  <input
                    id={`${key}-quantity`}
                    type="text"
                    inputMode="numeric"
                    value={row.quantity}
                    maxLength={80}
                    className="input-apple mt-1 min-h-11 w-full"
                    onChange={(event) =>
                      patch(row, { quantity: event.target.value })
                    }
                  />
                </label>
                <p className="text-footnote text-label-secondary">
                  {text.groceryHint}
                </p>
                {row.listName && (
                  <p className="text-footnote text-label-secondary">
                    {text.suggestedList}: {row.listName}
                  </p>
                )}
              </>
            )}
            {row.kind === "task" && (
              <div className="space-y-2">
                <p className="text-footnote text-label-secondary">
                  {text.taskHint}
                </p>
                {parent && (
                  <a
                    className="btn-plain inline-flex min-h-11 items-center"
                    href="/dashboard/chores/create"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {text.chore}
                  </a>
                )}
              </div>
            )}
            <button
              type="button"
              className="btn-plain min-h-11"
              onClick={() =>
                onChange({
                  ...value,
                  rows: value.rows.filter(
                    (current) => current.clientId !== row.clientId,
                  ),
                })
              }
            >
              {text.remove}
            </button>
          </fieldset>
        );
      })}
      {value.rows.length > 5 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-footnote" role="status">
            {offset + 1}–{Math.min(value.rows.length, offset + 5)} /{" "}
            {value.rows.length}
          </span>
          <button
            type="button"
            className="btn-plain min-h-11"
            disabled={offset === 0}
            onClick={() => setOffset((current) => Math.max(0, current - 5))}
          >
            {text.previous}
          </button>
          <button
            type="button"
            className="btn-plain min-h-11"
            disabled={offset + 5 >= value.rows.length}
            onClick={() => setOffset((current) => current + 5)}
          >
            {text.next}
          </button>
        </div>
      )}
      {value.rows.length > 0 && (
        <label htmlFor={`${id}-note`} className="block text-subhead">
          {text.note}
          <textarea
            id={`${id}-note`}
            value={value.note}
            maxLength={2000}
            rows={2}
            className="input-apple mt-1 w-full"
            onChange={(event) =>
              onChange({ ...value, note: event.target.value })
            }
          />
        </label>
      )}
    </fieldset>
  );
}
