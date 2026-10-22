"use client";
import Link from "next/link";
import SavedRequestsReview from "./SavedRequestsReview";
import CaptureInboxReview from "./CaptureInboxReview";
import * as React from "react";
import type { InboxPage } from "@/lib/review-inbox/read";
import { useReviewInboxText } from "@/i18n/review-inbox";
import { PreparationEntry } from "@/components/calendar/preparation/PreparationEntry";
function href(source: InboxPage["source"], after?: string | null) {
  const params = new URLSearchParams({ source });
  if (after) params.set("after", after);
  return `/dashboard/review?${params}`;
}
export default function ReviewInbox({
  page,
  identity,
}: {
  page: InboxPage;
  identity: { userId: string; familyId: string };
}) {
  const copy = useReviewInboxText();
  const [window, setWindow] = React.useState(0);
  const identityKey = JSON.stringify([identity.userId, identity.familyId]);
  const [captureOpened, setCaptureOpened] = React.useState<string | null>(
    page.source === "capture" ? identityKey : null,
  );
  React.useEffect(() => {
    if (page.source === "capture") setCaptureOpened(identityKey);
  }, [page.source, identityKey]);
  React.useEffect(() => setWindow(0), [page]);
  const shown = page.items.slice(window, window + 5);
  if (page.state === "forbidden") return null;
  return (
    <section className="space-y-5">
      <header>
        <h1 className="text-title-1 text-label-primary">{copy.title}</h1>
        <p className="mt-2 max-w-2xl text-body text-label-secondary">
          {copy.intro}
        </p>
      </header>
      <nav aria-label={copy.title} className="flex flex-wrap gap-2">
        {(["checks", "preparation", "saved", "capture"] as const).map(
          (source) => (
            <Link
              key={source}
              href={href(source)}
              aria-current={source === page.source ? "page" : undefined}
              className="btn-tinted min-h-11"
            >
              {copy[source]}
            </Link>
          ),
        )}
      </nav>
      {(captureOpened === identityKey || page.source === "capture") && (
        <CaptureInboxReview
          key={identityKey}
          active={page.source === "capture"}
        />
      )}
      {page.source === "capture" ? null : page.source === "saved" ? (
        <SavedRequestsReview identity={identity} />
      ) : page.state === "paused" ? (
        <p role="status">{copy.paused}</p>
      ) : (
        <>
          {shown.length ? (
            <ul className="list-inset divide-y divide-[var(--surface-separator)]">
              {shown.map((item) => (
                <li key={item.id} className="p-4">
                  <h2 className="text-headline text-label-primary break-words">
                    {item.title}
                  </h2>
                  <p className="text-footnote text-label-secondary">
                    {item.kind === "check" ? copy.waiting : copy.changed}
                  </p>
                  {item.kind === "check" ? (
                    <Link
                      className="btn-plain min-h-11"
                      href="/dashboard/chores"
                    >
                      {copy.openChecks}
                    </Link>
                  ) : (
                    <PreparationEntry eventId={item.id} />
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p role="status">{copy.empty}</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {window > 0 && (
              <button
                type="button"
                className="btn-tinted min-h-11"
                onClick={() => setWindow(0)}
              >
                {copy.first}
              </button>
            )}
            {window + 5 < page.items.length ? (
              <button
                type="button"
                className="btn-tinted min-h-11"
                onClick={() => setWindow((value) => value + 5)}
              >
                {copy.next}
              </button>
            ) : (
              page.next && (
                <Link
                  className="btn-tinted min-h-11"
                  href={href(page.source, page.next)}
                >
                  {copy.next}
                </Link>
              )
            )}
          </div>
          {page.next && (
            <p className="text-footnote text-label-secondary">{copy.more}</p>
          )}
        </>
      )}
      <p className="max-w-2xl text-footnote text-label-secondary">
        {copy.scope}
      </p>
    </section>
  );
}
