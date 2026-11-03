"use client";
import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { usePreparationActive } from "@/components/calendar/preparation/PreparationProvider";
import { useScheduleReviewActive } from "@/components/calendar/review/ScheduleReviewProvider";
import { useDraftAwareRouter } from "@/components/layout/owned-draft-navigation";
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
  const [captureUnavailable, setCaptureUnavailable] = React.useState(false);
  const onAvailabilityChange = React.useCallback((value: "available" | "unavailable" | "retry") => {
    setCaptureUnavailable(value === "unavailable");
  }, []);
  const router = useDraftAwareRouter();
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
        <Capture open={!hidden} onDraftStateChange={setHasDraft} onAvailabilityChange={onAvailabilityChange} />
      </React.Suspense>
      {captureUnavailable && (
        <div className="rounded-xl border border-separator p-4 space-y-2">
          <p role="status" className="text-body text-label-secondary">{copy.captureUnavailable}</p>
          <Link href="/dashboard/settings#ai-capture" className="btn-plain min-h-11"
            onClick={(event) => {
              if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              if (hasDraft && !window.confirm(copy.leaveCaptureSettings)) return;
              void router.push("/dashboard/settings#ai-capture");
            }}>{copy.captureSettings}</Link>
        </div>
      )}
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
            event.preventDefault();
            if (hasDraft && !window.confirm(copy.leaveCapture)) return;
            void router.push("/dashboard/meals/explore");
          }}
        >
          {copy.recipeDrafts}
        </Link>
      </div>
    </section>
  );
}
