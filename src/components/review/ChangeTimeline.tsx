"use client";
import * as React from "react";
import Link from "next/link";
import { FEATURES } from "@/lib/features";
import { useFeatureDisplayCopy } from "@/i18n/feature-display";
import { useSearchParams } from "next/navigation";
import { usePreparationActive } from "@/components/calendar/preparation/PreparationProvider";
import { useScheduleReviewActive } from "@/components/calendar/review/ScheduleReviewProvider";
import { useDraftAwareRouter } from "@/components/layout/owned-draft-navigation";
import { useChangeTimelineText } from "@/i18n/change-timeline";
import { useDisplayLocale } from "@/components/ui/use-display-locale";
import { requestOwnedJson } from "@/lib/owned-request-http";
import {
  timelinePage,
  timelineHref,
  type TimelinePage,
} from "@/lib/review-inbox/timeline-contract";

/** Personal parent projection only. No cache, second journal, background replay,
 * actor inference from a selected profile, or generic historical Undo endpoint. */
export default function ChangeTimeline({
  identity,
}: {
  identity: { userId: string; familyId: string };
}) {
  const featureDisplay = useFeatureDisplayCopy();
  const router = useDraftAwareRouter();
  const copy = useChangeTimelineText(),
    locale = useDisplayLocale(),
    params = useSearchParams();
  const preparation = usePreparationActive(),
    schedule = useScheduleReviewActive();
  const suspended =
    preparation ||
    schedule ||
    params.has("responsibilityId") ||
    params.get("mode") === "fridge";
  const [source, setSource] = React.useState<TimelinePage["source"]>("all");
  const [page, setPage] = React.useState<TimelinePage | null>(null),
    [offset, setOffset] = React.useState(0);
  const [busy, setBusy] = React.useState(false),
    [notice, setNotice] = React.useState<"error" | "owner" | null>(null);
  const epoch = React.useRef(0),
    controller = React.useRef<AbortController | null>(null);
  const original = React.useRef<TimelinePage["owner"] | null>(null);
  const retired = React.useRef(false);
  const latest = React.useRef({ identity, source, suspended });
  latest.current = { identity, source, suspended };
  const [projection, setProjection] = React.useState<string | null>(null);
  const key = JSON.stringify([identity.userId, identity.familyId, source]);
  const clear = React.useCallback(() => {
    epoch.current++;
    controller.current?.abort();
    controller.current = null;
    setPage(null);
    setProjection(null);
    setBusy(false);
    setOffset(0);
    setNotice(retired.current ? "owner" : null);
  }, []);
  React.useEffect(() => {
    clear();
    return () => {
      epoch.current++;
      controller.current?.abort();
    };
  }, [identity.userId, identity.familyId, source, suspended, clear]);
  React.useEffect(() => {
    const hidden = () => {
      if (document.visibilityState !== "visible") clear();
    };
    window.addEventListener("blur", clear);
    window.addEventListener("storage", clear);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("blur", clear);
      window.removeEventListener("storage", clear);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [clear]);
  async function load(cursor?: string) {
    if (
      retired.current ||
      controller.current ||
      latest.current.suspended ||
      document.visibilityState !== "visible"
    )
      return;
    const operation = ++epoch.current,
      selected = latest.current.source,
      expected = { ...latest.current.identity };
    const request = new AbortController();
    controller.current = request;
    setPage(null);
    setProjection(null);
    setOffset(0);
    setNotice(null);
    setBusy(true);
    const current = () =>
      epoch.current === operation &&
      !request.signal.aborted &&
      !latest.current.suspended &&
      latest.current.source === selected &&
      latest.current.identity.userId === expected.userId &&
      latest.current.identity.familyId === expected.familyId;
    try {
      const query = new URLSearchParams({ source: selected });
      if (cursor) query.set("cursor", cursor);
      const result = await requestOwnedJson(
        `/api/review/timeline?${query}`,
        { signal: request.signal },
        65536,
      );
      if (!current()) return;
      if (result.kind !== "reply") throw new Error();
      if ([401, 403].includes(result.response.status)) {
        retired.current = true;
        setNotice("owner");
        return;
      }
      if (!result.response.ok) throw new Error();
      const parsed = timelinePage.parse(result.body),
        owner = parsed.owner,
        prior = original.current;
      if (
        owner.userId !== expected.userId ||
        owner.familyId !== expected.familyId ||
        parsed.source !== selected ||
        (prior &&
          (owner.userId !== prior.userId ||
            owner.familyId !== prior.familyId ||
            owner.generation !== prior.generation))
      ) {
        retired.current = true;
        setNotice("owner");
        return;
      }
      original.current ??= owner;
      setPage(parsed);
      setProjection(
        JSON.stringify([expected.userId, expected.familyId, selected]),
      );
    } catch {
      if (current()) setNotice("error");
    } finally {
      if (current()) {
        controller.current = null;
        setBusy(false);
      }
    }
  }
  // First mount and focus do not fetch private data automatically. Explicit
  // refresh establishes an owner; this component never adopts another owner.
  const shown = projection === key ? page : null;
  if (suspended) return <p role="status">{copy.paused}</p>;
  const origins = {
    app: copy.app,
    settings: copy.settingsSource,
    preparation: copy.preparation,
    schedule: copy.schedule,
    responsibility: copy.responsibility,
    recipes: copy.recipes,
  };
  return (
    <section aria-label={copy.title} className="max-w-3xl space-y-4">
      <p className="text-body text-label-secondary">{copy.hint}</p>
      <div className="flex flex-wrap gap-2">
        <label className="text-subhead">
          {copy.title}
          <select
            className="input-apple min-h-11 ms-2"
            value={source}
            disabled={busy}
            onChange={(event) => {
              clear();
              setSource(event.target.value as TimelinePage["source"]);
            }}
          >
            {(["all", "coordination", "settings"] as const).map((value) => (
              <option key={value} value={value}>
                {copy[value]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn-tinted min-h-11"
          disabled={busy || notice === "owner"}
          onClick={() => void load()}
        >
          {busy ? copy.loading : copy.refresh}
        </button>
      </div>
      {notice && (
        <p role="alert" className="text-footnote text-[var(--danger-text)]">
          {copy[notice]}
        </p>
      )}
      {shown && (
        <>
          {shown.entries.length ? (
            <ol className="list-inset divide-y divide-[var(--surface-separator)]">
              {shown.entries.slice(offset, offset + 5).map((entry) => (
                <li key={entry.id} className="space-y-1 p-4">
                  <p className="text-headline break-words">
                    {copy.actions[entry.action]}
                    {entry.featureKey &&
                    FEATURES.some((feature) => feature.key === entry.featureKey)
                      ? ` · ${featureDisplay(FEATURES.find((feature) => feature.key === entry.featureKey)!.key).title}`
                      : entry.title
                        ? ` · ${entry.title}`
                        : ""}
                  </p>
                  <p className="text-footnote text-label-secondary break-words">
                    {entry.actor.kind === "tablet"
                      ? copy.tablet
                      : entry.actor.kind === "unknown"
                        ? copy.unknownActor
                        : (entry.actor.name ?? copy.former)}{" "}
                    · {origins[entry.origin]}
                  </p>
                  <time
                    dateTime={entry.at}
                    className="block text-footnote text-label-secondary"
                  >
                    {new Date(entry.at).toLocaleString(locale)}
                  </time>
                  {entry.target ? (
                    <Link
                      className="btn-plain inline-flex min-h-11 items-center"
                      href={timelineHref(entry.target)}
                      onClick={(event) => {
                        if (
                          event.button !== 0 ||
                          event.metaKey ||
                          event.ctrlKey ||
                          event.shiftKey ||
                          event.altKey
                        )
                          return;
                        event.preventDefault();
                        void router.push(timelineHref(entry.target));
                      }}
                    >
                      {copy.open}
                    </Link>
                  ) : (
                    <p className="text-footnote text-label-secondary">
                      {entry.current === "unavailable"
                        ? copy.unavailable
                        : copy.unknownRecord}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          ) : (
            <p role="status">{copy.empty}</p>
          )}
          <div className="flex flex-wrap gap-2">
            {offset > 0 && (
              <button
                type="button"
                className="btn-plain min-h-11"
                onClick={() => setOffset((value) => Math.max(0, value - 5))}
              >
                {copy.previous}
              </button>
            )}
            {offset + 5 < shown.entries.length && (
              <button
                type="button"
                className="btn-plain min-h-11"
                onClick={() => setOffset((value) => value + 5)}
              >
                {copy.next}
              </button>
            )}
            {shown.nextCursor && offset + 5 >= shown.entries.length && (
              <button
                type="button"
                className="btn-tinted min-h-11"
                disabled={busy}
                onClick={() => void load(shown.nextCursor!)}
              >
                {copy.older}
              </button>
            )}
          </div>
          {shown.nextCursor && (
            <p className="text-footnote text-label-secondary">{copy.more}</p>
          )}
        </>
      )}
    </section>
  );
}
