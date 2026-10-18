"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useBulkCookingText } from "@/i18n/bulk-cooking";
import { cn } from "@/lib/utils";

type MealView = "plan" | "explore" | "prep";

/** One route-aware entry point for the existing meal, recipe and prep journeys. */
export function MealViewNav({ active }: { active: MealView }) {
  return (
    <Suspense fallback={<div className="h-[52px]" aria-hidden="true" />}>
      <MealViewLinks active={active} />
    </Suspense>
  );
}

function MealViewLinks({ active }: { active: MealView }) {
  const search = useSearchParams();
  const text = useBulkCookingText();
  const views = [
    { key: "plan", label: text("navPlan") },
    { key: "explore", label: text("navExplore") },
    { key: "prep", label: text("navPrep") },
  ] as const;

  return (
    <nav
      aria-label={text("views")}
      className="flex w-fit max-w-full flex-wrap gap-1 rounded-2xl bg-[var(--surface-fill)] p-1"
    >
      {views.map(({ key, label }) => {
        // Keep the selected week and other existing route context. View belongs
        // only to the planner; recipe exploration has its own canonical route.
        const params = new URLSearchParams(search.toString());
        if (key === "prep") params.set("view", "bulk");
        else params.delete("view");
        const query = params.toString();
        const path =
          key === "explore" ? "/dashboard/meals/explore" : "/dashboard/meals";
        return (
          <Link
            key={key}
            href={`${path}${query ? `?${query}` : ""}`}
            aria-current={active === key ? "page" : undefined}
            className={cn(
              "inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl px-4 py-2 text-subhead font-semibold",
              active === key
                ? "bg-[var(--surface-elevated)] text-label-primary shadow-sm"
                : "text-label-secondary hover:text-label-primary",
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
