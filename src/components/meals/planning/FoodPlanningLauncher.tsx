"use client";
import * as React from "react";
import { useSearchParams, usePathname } from "next/navigation";
import { useDraftAwareRouter } from "@/components/layout/owned-draft-navigation";
import { usePreparationActive } from "@/components/calendar/preparation/PreparationProvider";
import { useFoodPlanningEntryText } from "@/i18n/food-planning-entry";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { useFoodPlanningAccess } from "./FoodPlanningAccess";
const Sheet = React.lazy(() => import("./FoodPlanningSheet"));
export function FoodPlanningLauncher({
  day,
  mode,
  onSaved,
}: {
  day: string;
  mode: "meals" | "prep";
  onSaved: () => void;
}) {
  const access = useFoodPlanningAccess(),
    params = useSearchParams(),
    pathname = usePathname(),
    router = useDraftAwareRouter(),
    preparing = usePreparationActive();
  const text = useFoodPlanningEntryText();
  const location = params.get("foodPlan"),
    recovery = location === "recovery",
    requested = recovery || (location === "new" && access.enabled),
    [open, setOpen] = React.useState(requested);
  const previousRecovery = React.useRef(requested);
  React.useEffect(() => {
    if (requested && !previousRecovery.current) setOpen(true);
    previousRecovery.current = requested;
  }, [requested]);
  if (!access.personalRole || preparing || params.get("mode") === "fridge")
    return null;
  function close() {
    setOpen(false);
    if (location === "recovery" || location === "new") {
      const next = new URLSearchParams(params.toString());
      next.delete("foodPlan");
      void router.replace(`${pathname}${next.size ? `?${next}` : ""}`, {
        scroll: false,
      });
    }
  }
  return (
    <>
      {(access.enabled || recovery) && (
        <button
          type="button"
          className="btn-secondary min-h-[44px]"
          onClick={() => setOpen(true)}
        >
          {recovery
            ? text("savedFoodWork")
            : mode === "prep"
              ? text("severalDishes")
              : text("severalMeals")}
        </button>
      )}
      {open && (
        <ErrorBoundary>
          <React.Suspense
            fallback={
              <p role="status">
                {text("loadingPlanner")}
              </p>
            }
          >
            <Sheet day={day} mode={mode} onClose={close} onSaved={onSaved} />
          </React.Suspense>
        </ErrorBoundary>
      )}
    </>
  );
}
