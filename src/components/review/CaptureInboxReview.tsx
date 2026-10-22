"use client";
import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { usePreparationActive } from "@/components/calendar/preparation/PreparationProvider";
import { useScheduleReviewActive } from "@/components/calendar/review/ScheduleReviewProvider";
import { useReviewInboxText } from "@/i18n/review-inbox";
const Capture = React.lazy(() =>
  import("@/components/capture/CaptureBox").then((module) => ({
    default: module.CaptureBox,
  })),
);
/** Reuse the domain editor/recovery, never initialize a competing journal for a count.
 * Hiding beneath a sibling overlay preserves its in-memory draft and exact intents. */
export default function CaptureInboxReview({ active }: { active: boolean }) {
  const [hasDraft, setHasDraft] = React.useState(false);
  const copy = useReviewInboxText(),
    params = useSearchParams();
  const preparationActive = usePreparationActive(),
    scheduleActive = useScheduleReviewActive();
  const hidden =
    !active ||
    preparationActive ||
    scheduleActive ||
    params.has("responsibilityId") ||
    params.get("mode") === "fridge";
  return (
    <section
      hidden={hidden}
      aria-label={copy.capture}
      className="max-w-2xl space-y-4"
    >
      <p className="text-body text-label-secondary">{copy.captureHint}</p>
      <React.Suspense fallback={<p role="status">{copy.loadingReview}</p>}>
        <Capture onDraftStateChange={setHasDraft} />
      </React.Suspense>
      <div className="border-t border-[var(--surface-separator)] pt-4">
        <p className="text-footnote text-label-secondary">{copy.recipeHint}</p>
        <Link
          className="btn-plain min-h-11"
          href="/dashboard/meals/explore"
          onClick={(event) => {
            if (
              event.button !== 0 ||
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey
            )
              return;
            if (hasDraft && !window.confirm(copy.leaveCapture))
              event.preventDefault();
          }}
        >
          {copy.recipeDrafts}
        </Link>
      </div>
    </section>
  );
}
