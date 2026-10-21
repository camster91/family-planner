"use client";
import { usePreparationActive } from "@/components/calendar/preparation/PreparationProvider";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  scheduleReviewScope,
  type ScheduleReviewScope,
} from "@/lib/calendar-planning/conflict-review";
import { useScheduleReviewText } from "@/i18n/schedule-review";
const Sheet = React.lazy(() => import("./ScheduleReviewSheet"));
const Context = React.createContext<{
  active: boolean;
  allowed: boolean;
  open: (scope: ScheduleReviewScope) => void;
} | null>(null);
/** Personal owner context is fetched on explicit opening, never layout-seeded
 * onto a signed-in fridge surface. Only gate/known role enter this provider. */
export default function ScheduleReviewProvider({
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
    copy = useScheduleReviewText();
  const pushed = React.useRef<string | null>(null),
    navigating = React.useRef(false),
    closing = React.useRef(false);
  const preparationActive = usePreparationActive();
  const personal =
    !preparationActive &&
    ["parent", "teen", "child"].includes(role) &&
    params.get("mode") !== "fridge" &&
    !pathname.startsWith("/device");
  const allowed = enabled && personal;
  const parsed = scheduleReviewScope.safeParse({
    targetId: params.get("reviewEvent"),
    range: { start: params.get("reviewStart"), end: params.get("reviewEnd") },
    timeZone: params.get("reviewZone"),
  });
  const scope = personal && parsed.success ? parsed.data : null;
  const isOpen = !!scope;
  const url = `${pathname}${params.size ? `?${params}` : ""}`;
  React.useEffect(() => {
    navigating.current = false;
    if (closing.current && !isOpen) {
      closing.current = false;
      const active = document.activeElement;
      if (!active || active === document.body || !active.isConnected) {
        const heading = document.querySelector<HTMLElement>(
          "#main-content h1, #main-content h2",
        );
        if (heading) {
          heading.tabIndex = -1;
          heading.focus();
        }
      }
    }
  }, [url, isOpen]);
  function open(input: ScheduleReviewScope) {
    const nextScope = scheduleReviewScope.safeParse(input);
    if (
      !personal ||
      !nextScope.success ||
      navigating.current ||
      (scope && JSON.stringify(scope) === JSON.stringify(nextScope.data))
    )
      return;
    navigating.current = true;
    const next = new URLSearchParams(params.toString());
    next.delete("prepareEvent");
    next.delete("prepareZone");
    next.delete("responsibilityKind");
    next.delete("responsibilityId");
    next.set("reviewEvent", input.targetId);
    next.set("reviewStart", input.range.start);
    next.set("reviewEnd", input.range.end);
    next.set("reviewZone", input.timeZone);
    const target = `${pathname}?${next}`;
    if (scope) {
      pushed.current = null;
      router.replace(target, { scroll: false });
    } else {
      pushed.current = target;
      router.push(target, { scroll: false });
    }
  }
  function close() {
    if (navigating.current) return;
    closing.current = true;
    navigating.current = true;
    if (pushed.current === url) {
      pushed.current = null;
      router.back();
    } else {
      const next = new URLSearchParams(params.toString());
      for (const key of [
        "reviewEvent",
        "reviewStart",
        "reviewEnd",
        "reviewZone",
      ])
        next.delete(key);
      router.replace(`${pathname}${next.size ? `?${next}` : ""}`, {
        scroll: false,
      });
    }
  }
  return (
    <Context.Provider value={{ active: !!scope, allowed, open }}>
      {children}
      {scope && (
        <ErrorBoundary
          key={JSON.stringify(scope)}
          fallback={
            <div role="alert" className="p-4">
              <p>{copy.error}</p>
              <button
                type="button"
                className="min-h-11 px-4 py-2"
                onClick={close}
              >
                {copy.close}
              </button>
            </div>
          }
        >
          <React.Suspense fallback={<p role="status">{copy.loading}</p>}>
            <Sheet
              key={JSON.stringify(scope)}
              initialScope={scope}
              onClose={close}
              onOpen={open}
            />
          </React.Suspense>
        </ErrorBoundary>
      )}
    </Context.Provider>
  );
}
export function useScheduleReviewActive() {
  return React.useContext(Context)?.active ?? false;
}
export function ScheduleReviewButton({
  scope,
  beforeOpen,
  className = "",
}: {
  scope: ScheduleReviewScope;
  beforeOpen?: () => void;
  className?: string;
}) {
  const context = React.useContext(Context),
    copy = useScheduleReviewText();
  if (!context?.allowed || !scheduleReviewScope.safeParse(scope).success)
    return null;
  return (
    <button
      type="button"
      className={`min-h-11 rounded-xl px-3 py-2 text-callout font-medium text-[var(--accent-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)] ${className}`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={() => {
        beforeOpen?.();
        context.open(scope);
      }}
    >
      {copy.open}
    </button>
  );
}
