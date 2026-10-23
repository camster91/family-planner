"use client";
import * as React from "react";
import { PREPARATION_CHANGED_EVENT } from "@/lib/event-preparation/changes";
import { useDraftAwareRouter as useRouter } from "@/components/layout/owned-draft-navigation";
import { usePathname, useSearchParams } from "next/navigation";
import {
  preparationLocationSchema,
  type PreparationLocation,
} from "@/lib/preparation-location-contract";
import { usePreparationShellText } from "@/i18n/event-preparation-shell";
import { ErrorBoundary } from "@/components/ui/error-boundary";
const Sheet = React.lazy(() => import("./PreparationSheet"));
export type { PreparationLocation } from "@/lib/preparation-location-contract";
const Context = React.createContext<{
  active: boolean;
  allowed: boolean;
  open: (location: PreparationLocation) => void;
} | null>(null);
export default function PreparationProvider({
  enabled,
  role,
  children,
}: {
  enabled: boolean;
  role: string;
  children: React.ReactNode;
}) {
  const path = usePathname(),
    params = useSearchParams(),
    router = useRouter(),
    copy = usePreparationShellText();
  const personal =
    role === "parent" &&
    params.get("mode") !== "fridge" &&
    !path.startsWith("/device");
  const parsed = preparationLocationSchema.safeParse({
    eventId: params.get("prepareEvent"),
    timeZone: params.get("prepareZone"),
  });
  const location = personal && parsed.success ? parsed.data : null;
  const pushed = React.useRef<string | null>(null),
    navigating = React.useRef(false),
    closing = React.useRef(false);
  const url = `${path}${params.toString() ? `?${params}` : ""}`;
  React.useEffect(() => {
    const refresh = () => router.refresh();
    window.addEventListener(PREPARATION_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(PREPARATION_CHANGED_EVENT, refresh);
  }, [router]);
  React.useEffect(() => {
    navigating.current = false;
    if (closing.current && !location) {
      closing.current = false;
      if (
        !document.activeElement ||
        document.activeElement === document.body ||
        !document.activeElement.isConnected
      ) {
        const heading = document.querySelector<HTMLElement>(
          "#main-content h1, #main-content h2",
        );
        if (heading) {
          heading.tabIndex = -1;
          heading.focus();
        }
      }
    }
  }, [url, !!location]);
  function observeNavigation(
    request: Promise<boolean>,
    previous: string | null,
  ) {
    void request.then((allowed) => {
      if (!allowed) {
        navigating.current = false;
        pushed.current = previous;
        closing.current = false;
      }
    });
  }
  function open(input: PreparationLocation) {
    const checked = preparationLocationSchema.safeParse(input);
    if (
      !personal ||
      !checked.success ||
      navigating.current ||
      JSON.stringify(location) === JSON.stringify(checked.data)
    )
      return;
    const next = new URLSearchParams(params.toString());
    for (const key of [
      "responsibilityKind",
      "responsibilityId",
      "reviewEvent",
      "reviewStart",
      "reviewEnd",
      "reviewZone",
    ])
      next.delete(key);
    next.set("prepareEvent", input.eventId);
    next.set("prepareZone", input.timeZone);
    const target = `${path}?${next}`;
    const previousPushed = pushed.current;
    navigating.current = true;
    if (location) {
      pushed.current = null;
      observeNavigation(
        router.replace(target, { scroll: false }),
        previousPushed,
      );
    } else {
      pushed.current = target;
      observeNavigation(router.push(target, { scroll: false }), previousPushed);
    }
  }
  function close() {
    if (navigating.current) return;
    closing.current = true;
    const previousPushed = pushed.current;
    navigating.current = true;
    if (pushed.current === url) {
      pushed.current = null;
      observeNavigation(router.back(), previousPushed);
    } else {
      const next = new URLSearchParams(params.toString());
      next.delete("prepareEvent");
      next.delete("prepareZone");
      observeNavigation(
        router.replace(`${path}${next.toString() ? `?${next}` : ""}`, {
          scroll: false,
        }),
        previousPushed,
      );
    }
  }
  return (
    <Context.Provider
      value={{ active: !!location, allowed: enabled && personal, open }}
    >
      {children}
      {location && (
        <ErrorBoundary
          key={JSON.stringify(location)}
          fallback={
            <div role="alert">
              <p>{copy.error}</p>
              <button className="min-h-11 px-4" onClick={close}>
                {copy.close}
              </button>
            </div>
          }
        >
          <React.Suspense fallback={<p role="status">{copy.loading}</p>}>
            <Sheet
              key={JSON.stringify(location)}
              location={location}
              onClose={close}
              onOpen={open}
            />
          </React.Suspense>
        </ErrorBoundary>
      )}
    </Context.Provider>
  );
}
export function usePreparationActive() {
  return React.useContext(Context)?.active ?? false;
}
export function PreparationButton({
  location,
  beforeOpen,
  backlink = false,
}: {
  location: PreparationLocation;
  beforeOpen?: () => void;
  backlink?: boolean;
}) {
  const context = React.useContext(Context),
    copy = usePreparationShellText();
  if (
    !context?.allowed ||
    !preparationLocationSchema.safeParse(location).success
  )
    return null;
  return (
    <button
      type="button"
      className="min-h-11 rounded-xl px-4 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]"
      onClick={() => {
        beforeOpen?.();
        context.open(location);
      }}
    >
      {backlink ? copy.backlink : copy.open}
    </button>
  );
}
