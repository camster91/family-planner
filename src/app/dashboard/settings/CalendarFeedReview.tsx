"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { requestOwnedJson } from "@/lib/owned-request-http";
import { calendarFeedReviewPage, CALENDAR_FEED_REVIEW_SCOPE_HEADER, type CalendarFeedReviewPage } from "@/lib/calendar-feed-review-contract";
import { useDisplayLocale } from "@/components/ui/use-display-locale";
import { useSettingsCopy } from "./settings-copy";

/** Read-only parent repair discovery. Existing editors retain all mutation authority. */
export default function CalendarFeedReview({ scope }: { scope: string }) {
  const copy = useSettingsCopy();
  const locale = useDisplayLocale();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error" | "scope-changed">("idle");
  const [data, setData] = useState<{ scope: string; page: CalendarFeedReviewPage } | null>(null);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const attempted = useRef<string | null>(null);
  useEffect(() => {
    setOpen(false); setData(null); setState("idle");
    return () => { generation.current++; request.current?.abort(); };
  }, [scope]);
  const close = () => {
    generation.current++; request.current?.abort(); request.current = null;
    setOpen(false); setData(null); setState("idle");
  };
  async function load(cursor: string | null = null) {
    const own = ++generation.current;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    attempted.current = cursor;
    setOpen(true); setData(null); setState("loading");
    try {
      const params = cursor ? `?${new URLSearchParams({ cursor })}` : "";
      const response = await requestOwnedJson(`/api/calendar/feed/review${params}`, { signal: controller.signal, headers: { [CALENDAR_FEED_REVIEW_SCOPE_HEADER]: scope } }, 512 * 1024);
      if (response.kind === "reply" && response.response.status === 409) {
        if (own === generation.current) setState("scope-changed");
        return;
      }
      if (response.kind !== "reply" || !response.response.ok) throw new Error();
      const page = calendarFeedReviewPage.parse(response.body);
      if (cursor !== null && page.nextCursor === cursor) throw new Error();
      if (own !== generation.current) return;
      setData({ scope, page }); setState("ready");
    } catch { if (own === generation.current) setState("error"); }
    finally { if (request.current === controller) request.current = null; }
  }
  const page = data?.scope === scope && state === "ready" ? data.page : null;
  return <>
    <button type="button" className="btn-tinted min-h-[44px]" onClick={() => void load()}>{copy("feedReview")}</button>
    <Dialog open={open} onClose={close} title={copy("feedReview")} description={copy("feedReviewDescription")} closeLabel={copy("close")} variant="form">
      {state === "loading" && <p role="status">{copy("feedReviewLoading")}</p>}
      {state === "scope-changed" && <div role="alert" className="space-y-3">
        <p>{copy("feedReviewScopeChanged")}</p>
        <Link
          href="/dashboard/settings"
          className="btn-tinted inline-flex items-center min-h-[44px]"
          onClick={(event) => {
            if (
              event.button !== 0 ||
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey
            )
              return;
            // Scope changes require a fresh settings/session projection. Keep
            // the old full-document reload behavior while using Next's Link
            // for the internal destination and modifier-key semantics.
            event.preventDefault();
            close();
            window.location.assign("/dashboard/settings");
          }}
        >
          {copy("feedReviewReload")}
        </Link>
      </div>}
      {state === "error" && <div role="alert" className="space-y-3">
        <p>{copy("feedReviewFailed")}</p>
        <button type="button" className="btn-tinted min-h-[44px]" onClick={() => void load(attempted.current)}>{copy("feedReviewRetry")}</button>
      </div>}
      {page && <div className="space-y-4">
        <p role="status">{copy("feedReviewChecked", { count: new Intl.NumberFormat(locale).format(page.checked) })}</p>
        {page.issues.length === 0 ? <p>{copy("feedReviewClear")}</p> : <ul className="space-y-3">
          {page.issues.map(issue => <li key={issue.id} className="rounded-xl border border-separator p-3">
            <p className="font-medium break-words">{issue.title}</p>
            <Link className="inline-flex min-h-[44px] items-center text-[var(--accent-text)] underline" onClick={close}
              href={issue.source === "local" ? `/dashboard/calendar/edit?id=${encodeURIComponent(issue.id)}` :
                `/dashboard/settings#${issue.source === "connected" ? "calendar-sync" : "calendar-subscriptions"}`}>
              {copy(issue.source === "local" ? "feedReviewEdit" : "feedReviewSource")}
            </Link>
          </li>)}
        </ul>}
        <div className="flex flex-wrap gap-2">
          {page.nextCursor && <button type="button" className="btn-tinted min-h-[44px]" onClick={() => void load(page.nextCursor)}>{copy("feedReviewMore")}</button>}
          <button type="button" className="btn-tinted min-h-[44px]" onClick={() => void load()}>{copy("feedReviewRestart")}</button>
        </div>
      </div>}
    </Dialog>
  </>;
}
