"use client";
import * as React from "react";
import { useSearchParams, usePathname } from "next/navigation";
import { useDraftAwareRouter } from "@/components/layout/owned-draft-navigation";
import { usePreparationActive } from "@/components/calendar/preparation/PreparationProvider";
import { useTranslation } from "@/i18n";
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
    preparing = usePreparationActive(),
    { locale } = useTranslation(),
    es = locale === "es";
  const recovery = params.get("foodPlan") === "recovery",
    [open, setOpen] = React.useState(recovery);
  const previousRecovery = React.useRef(recovery);
  React.useEffect(() => {
    if (recovery && !previousRecovery.current) setOpen(true);
    previousRecovery.current = recovery;
  }, [recovery]);
  if (!access.personalRole || preparing || params.get("mode") === "fridge")
    return null;
  function close() {
    setOpen(false);
    if (recovery) {
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
            ? es
              ? "Trabajo de comidas guardado"
              : "Saved food work"
            : mode === "prep"
              ? es
                ? "Planificar varios platos"
                : "Plan several dishes"
              : es
                ? "Planificar varias comidas"
                : "Plan several meals"}
        </button>
      )}
      {open && (
        <ErrorBoundary>
          <React.Suspense
            fallback={
              <p role="status">
                {es ? "Cargando planificador…" : "Loading planner…"}
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
