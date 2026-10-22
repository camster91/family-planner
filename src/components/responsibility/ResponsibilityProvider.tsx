"use client";
import { usePreparationActive } from "@/components/calendar/preparation/PreparationProvider";
import { useScheduleReviewActive } from "@/components/calendar/review/ScheduleReviewProvider";
import * as React from "react";
import { useDraftAwareRouter as useRouter } from "@/components/layout/owned-draft-navigation";
import { usePathname, useSearchParams } from "next/navigation";
import {
  responsibilityTarget,
  type ResponsibilityTarget,
} from "@/lib/responsibility";
import { useResponsibilityText } from "@/i18n/responsibility";
const Preview = React.lazy(() => import("./ResponsibilityPreview"));
const Sheet = React.lazy(() => import("./ResponsibilitySheet"));
type Controls = {
  active: boolean;
  allowed: (target: ResponsibilityTarget) => boolean;
  open: (target: ResponsibilityTarget) => void;
};
const Context = React.createContext<Controls | null>(null);
/** Only gate and role are serialized by the layout. Personal identity is read
 * after an explicit opening, never seeded onto the shared fridge surface. */
export default function ResponsibilityProvider({
  enabled,
  role,
  children,
}: {
  enabled: boolean;
  role: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname(),
    params = useSearchParams(),
    router = useRouter(),
    copy = useResponsibilityText();
  const pushed = React.useRef<string | null>(null),
    navigating = React.useRef(false);
  const scheduleActive = useScheduleReviewActive();
  const preparationActive = usePreparationActive();
  const personal =
    !scheduleActive &&
    !preparationActive &&
    ["parent", "teen", "child"].includes(role) &&
    params.get("mode") !== "fridge" &&
    !pathname.startsWith("/device");
  const parsed = responsibilityTarget.safeParse({
    kind: params.get("responsibilityKind"),
    id: params.get("responsibilityId"),
  });
  const target =
    parsed.success &&
    personal &&
    !(role === "child" && parsed.data.kind === "handoff")
      ? parsed.data
      : null;
  const url = `${pathname}${params.toString() ? `?${params}` : ""}`;
  React.useEffect(() => {
    navigating.current = false;
  }, [url]);
  const eligible = (item: ResponsibilityTarget) =>
    personal && !(role === "child" && item.kind === "handoff");
  const allowed = (item: ResponsibilityTarget) => enabled && eligible(item);
  function observeNavigation(
    request: Promise<boolean>,
    previous: string | null,
  ) {
    void request.then((allowed) => {
      if (!allowed) {
        navigating.current = false;
        pushed.current = previous;
      }
    });
  }
  function open(item: ResponsibilityTarget) {
    if (
      !eligible(item) ||
      navigating.current ||
      (target?.kind === item.kind && target.id === item.id)
    )
      return;
    const previousPushed = pushed.current;
    navigating.current = true;
    const next = new URLSearchParams(params.toString());
    next.set("responsibilityKind", item.kind);
    next.set("responsibilityId", item.id);
    const destination = `${pathname}?${next}`;
    if (target) {
      pushed.current = null;
      observeNavigation(
        router.replace(destination, { scroll: false }),
        previousPushed,
      );
    } else {
      pushed.current = destination;
      observeNavigation(
        router.push(destination, { scroll: false }),
        previousPushed,
      );
    }
  }
  function close() {
    if (navigating.current) return;
    const previousPushed = pushed.current;
    navigating.current = true;
    if (pushed.current === url) {
      pushed.current = null;
      observeNavigation(router.back(), previousPushed);
    } else {
      const next = new URLSearchParams(params.toString());
      next.delete("responsibilityKind");
      next.delete("responsibilityId");
      observeNavigation(
        router.replace(`${pathname}${next.toString() ? `?${next}` : ""}`, {
          scroll: false,
        }),
        previousPushed,
      );
    }
  }
  return (
    <Context.Provider value={{ active: !!target, allowed, open }}>
      {children}
      {target && (
        <React.Suspense fallback={<p role="status">{copy.loading}</p>}>
          <Sheet
            key={`${target.kind}:${target.id}`}
            target={target}
            onClose={close}
            onOpen={open}
          />
        </React.Suspense>
      )}
    </Context.Provider>
  );
}
export function ResponsibilityButton({
  target,
  className = "",
}: {
  target: ResponsibilityTarget;
  className?: string;
}) {
  const context = React.useContext(Context),
    copy = useResponsibilityText();
  if (!context?.allowed(target)) return null;
  return (
    <button
      type="button"
      className={`min-h-11 rounded-xl px-3 py-2 text-footnote font-medium text-[var(--accent-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)] ${className}`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={() => context.open(target)}
    >
      {copy.open}
    </button>
  );
}

/** At most the three visible rows in each weekly group instantiate a preview.
 * Unmount while the mutation sheet is open; closing reads afresh, never keeps
 * a pre-change acceptance as a current post-change result. */
export function ResponsibilityReviewEntry({
  target,
}: {
  target: ResponsibilityTarget;
}) {
  const context = React.useContext(Context),
    copy = useResponsibilityText();
  if (!context?.allowed(target)) return null;
  return (
    <div className="mt-2">
      {!context.active && (
        <React.Suspense fallback={<p role="status">{copy.loading}</p>}>
          <Preview key={`${target.kind}:${target.id}`} target={target} />
        </React.Suspense>
      )}
      <ResponsibilityButton target={target} />
    </div>
  );
}
