"use client";
import * as React from "react";
import { useDraftAwareRouter as useRouter } from "@/components/layout/owned-draft-navigation";
import { usePathname, useSearchParams } from "next/navigation";
import { useWeeklyResetShellText } from "@/i18n/weekly-reset-shell";
import { toDateOnlyLocal } from "@/lib/dates";
import { addDaysToKey } from "@/lib/local-day-key";
import type { WeeklyResetScope } from "@/lib/weekly-reset";
const Review = React.lazy(() => import("./WeeklyResetReview"));
export default function WeeklyResetLauncher({
  userId,
  familyId,
}: {
  userId: string;
  familyId: string;
}) {
  const copy = useWeeklyResetShellText(),
    router = useRouter(),
    pathname = usePathname(),
    params = useSearchParams();
  const [scope, setScope] = React.useState<WeeklyResetScope | null>(null);
  const opening = React.useRef(false);
  const pushed = React.useRef<string | null>(null),
    closing = React.useRef(false);
  const open =
    params.get("weeklyReview") === "1" && params.get("mode") !== "fridge";
  React.useEffect(() => {
    closing.current = false;
    opening.current = false;
    if (!open) {
      setScope(null);
      return;
    }
    const now = new Date();
    const monday = addDaysToKey(
      toDateOnlyLocal(now),
      -((now.getDay() + 6) % 7),
    );
    setScope({
      weekStart: monday,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  }, [open]);
  function observeNavigation(
    request: Promise<boolean>,
    previous: string | null,
  ) {
    void request.then((allowed) => {
      if (!allowed) {
        closing.current = false;
        opening.current = false;
        pushed.current = previous;
      }
    });
  }
  function close() {
    if (closing.current) return;
    const previousPushed = pushed.current;
    closing.current = true;
    const target = `${pathname}?${params}`;
    if (pushed.current === target) {
      pushed.current = null;
      observeNavigation(router.back(), previousPushed);
    } else {
      const next = new URLSearchParams(params.toString());
      next.delete("weeklyReview");
      observeNavigation(
        router.replace(`${pathname}${next.size ? `?${next}` : ""}`, {
          scroll: false,
        }),
        previousPushed,
      );
    }
  }
  return (
    <>
      <button
        type="button"
        className="my-3 min-h-11 rounded-xl border border-[var(--surface-separator)] px-4 py-2 text-callout font-medium text-label-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]"
        onClick={() => {
          if (open || opening.current) return;
          const previousPushed = pushed.current;
          opening.current = true;
          const next = new URLSearchParams(params.toString());
          next.set("weeklyReview", "1");
          const target = `${pathname}?${next}`;
          pushed.current = target;
          observeNavigation(
            router.push(target, { scroll: false }),
            previousPushed,
          );
        }}
      >
        {copy.open}
      </button>
      {open && scope && (
        <React.Suspense fallback={<p role="status">{copy.loading}</p>}>
          <Review
            key={`${userId}:${familyId}`}
            userId={userId}
            familyId={familyId}
            initialScope={scope}
            onClose={close}
          />
        </React.Suspense>
      )}
    </>
  );
}
