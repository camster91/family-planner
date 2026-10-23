"use client";
import * as React from "react";
import { usePreparationText } from "@/i18n/event-preparation";
import { readPreparationPicker } from "@/lib/event-preparation/client";
import type {
  PreparationPickerQuery,
  PreparationPickerReply,
} from "@/lib/event-preparation/picker-contract";
import type { PreparationRecoveryContext } from "@/lib/event-preparation/recovery";
import type { PreparationLocation } from "./PreparationProvider";
export const prepControl =
  "min-h-11 rounded-xl px-4 py-2 text-callout focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] disabled:opacity-50";
export const prepPlain = `${prepControl} bg-[var(--surface-fill-secondary)] text-label-primary`;
export const prepInput =
  "min-h-11 w-full rounded-xl border border-[var(--surface-separator)] bg-[var(--surface-fill-secondary)] p-3 text-label-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]";
export default function PreparationPicker({
  location,
  context,
  kind,
  onPick,
  disabled,
  selectedIds = [],
}: {
  location: PreparationLocation;
  context: PreparationRecoveryContext;
  kind: PreparationPickerQuery["kind"];
  onPick: (item: PreparationPickerReply["items"][number]) => void;
  disabled: boolean;
  selectedIds?: string[];
}) {
  const copy = usePreparationText(),
    [search, setSearch] = React.useState(""),
    [query, setQuery] = React.useState({
      search: "",
      after: undefined as string | undefined,
    }),
    [page, setPage] = React.useState<PreparationPickerReply | null>(null),
    [busy, setBusy] = React.useState(true),
    [error, setError] = React.useState(false);
  const id = React.useId();
  const [windowIndex, setWindowIndex] = React.useState(0);
  React.useEffect(() => {
    let alive = true;
    setBusy(true);
    setError(false);
    setPage(null);
    setWindowIndex(0);
    void readPreparationPicker(
      { ...location, memberProtocol: "2", kind, ...query },
      context,
    )
      .then((value) => {
        if (alive) setPage(value);
      })
      .catch(() => {
        if (alive) setError(true);
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [
    location.eventId,
    location.timeZone,
    context.userId,
    context.familyId,
    context.owner?.scope,
    kind,
    query,
  ]);
  return (
    <section className="space-y-3">
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setQuery({ search: search.trim(), after: undefined });
        }}
      >
        <label className="grow" htmlFor={id}>
          <span className="sr-only">{copy.search}</span>
          <input
            id={id}
            className={prepInput}
            value={search}
            maxLength={100}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <button className={prepPlain} disabled={busy || disabled}>
          {copy.find}
        </button>
      </form>
      {busy && <p role="status">{copy.loading}</p>}
      {error && <p role="alert">{copy.error}</p>}
      {page && (
        <>
          <ul className="space-y-2">
            {page.items
              .slice(windowIndex * 5, (windowIndex + 1) * 5)
              .map((item) => (
                <li key={`${item.kind}:${item.id}`}>
                  <button
                    type="button"
                    disabled={
                      disabled ||
                      (item.kind === "task" && selectedIds.includes(item.id))
                    }
                    className={`${prepPlain} w-full text-left`}
                    onClick={() => onPick(item)}
                  >
                    {item.kind === "task" ? (
                      <>
                        <span className="block break-words">{item.title}</span>
                        <span className="block text-footnote">
                          {item.subjectName} · {item.dueDay}
                        </span>
                      </>
                    ) : item.kind === "routine" ? (
                      item.label
                    ) : (
                      item.name
                    )}
                  </button>
                </li>
              ))}
          </ul>
          {!page.items.length && <p>{copy.empty}</p>}
          {page.next && <p className="text-footnote">{copy.incomplete}</p>}
        </>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={prepPlain}
          disabled={(!query.after && windowIndex === 0) || busy || disabled}
          onClick={() => {
            setWindowIndex(0);
            setQuery((value) => ({ ...value, after: undefined }));
          }}
        >
          {copy.first}
        </button>
        <button
          type="button"
          className={prepPlain}
          disabled={
            (!page?.next &&
              (windowIndex + 1) * 5 >= (page?.items.length ?? 0)) ||
            busy ||
            disabled
          }
          onClick={() => {
            if ((windowIndex + 1) * 5 < (page?.items.length ?? 0))
              setWindowIndex(windowIndex + 1);
            else
              setQuery((value) => ({
                ...value,
                after: page?.next ?? undefined,
              }));
          }}
        >
          {copy.more}
        </button>
        {error && (
          <button
            type="button"
            className={prepPlain}
            onClick={() => setQuery((value) => ({ ...value }))}
          >
            {copy.reload}
          </button>
        )}
      </div>
    </section>
  );
}
