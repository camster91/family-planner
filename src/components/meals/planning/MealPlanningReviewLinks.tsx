"use client";
import Link from "next/link";
import { useFoodPlanningEntryText } from "@/i18n/food-planning-entry";
import { useDraftAwareRouter } from "@/components/layout/owned-draft-navigation";
import { useFoodPlanningAccess } from "./FoodPlanningAccess";
/** Capability/role only; no local-store discovery, source reads or writes here. */
export function MealPlanningReviewLinks({
  disabled,
  canNavigate,
  onNavigated,
}: {
  disabled: boolean;
  canNavigate: () => boolean;
  onNavigated?: () => void;
}) {
  const access = useFoodPlanningAccess();
  return access.personalRole ? (
    <Links
      enabled={access.enabled}
      disabled={disabled}
      canNavigate={canNavigate}
      onNavigated={onNavigated}
    />
  ) : null;
}
function Links({
  enabled,
  disabled,
  canNavigate,
  onNavigated,
}: {
  enabled: boolean;
  disabled: boolean;
  canNavigate: () => boolean;
  onNavigated?: () => void;
}) {
  const router = useDraftAwareRouter();
  const text = useFoodPlanningEntryText();
  const links = [
    ...(enabled
      ? [
          {
            href: "/dashboard/meals?foodPlan=new",
            label: text("planMeals"),
          },
        ]
      : []),
    {
      href: "/dashboard/meals?foodPlan=recovery",
      label: text("savedMealPlanning"),
    },
    {
      href: "/dashboard/meals?view=bulk&bulkWork=recovery",
      label: text("savedBulkCooking"),
    },
  ];
  return (
    <details className="rounded-xl border border-[var(--surface-separator)] p-3">
      <summary className="min-h-[44px] py-2 cursor-pointer font-semibold">
        {text("planningSavedWork")}
      </summary>
      <p className="text-footnote text-label-secondary">
        {text("continueBoundary")}
      </p>
      <div className="flex flex-wrap gap-2 mt-2">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="btn-tinted min-h-[44px] inline-flex items-center"
            aria-disabled={disabled}
            tabIndex={disabled ? -1 : undefined}
            onClick={(event) => {
              if (disabled || !canNavigate()) {
                event.preventDefault();
                return;
              }
              if (
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey
              )
                return;
              event.preventDefault();
              void router.push(link.href).then((navigated) => {
                if (navigated) onNavigated?.();
              });
            }}
          >
            {link.label}
          </Link>
        ))}
      </div>
    </details>
  );
}
