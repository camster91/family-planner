"use client";

import { Suspense, type ComponentProps } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { mealDayHref } from "@/lib/meal-navigation";

type Props = Omit<ComponentProps<typeof Link>, "href"> & {
  href: string;
  /** An edited meal day takes precedence over the currently viewed week. */
  day?: string;
};

/** Carry only valid calendar-day context, never arbitrary query strings or proof. */
export function MealContextLink(props: Props) {
  return (
    <Suspense
      fallback={
        <span className={props.className} aria-busy="true">
          {props.children}
        </span>
      }
    >
      <ContextLink {...props} />
    </Suspense>
  );
}
function ContextLink({ href, day, ...props }: Props) {
  const search = useSearchParams();
  return (
    <Link
      {...props}
      href={mealDayHref(href, day ?? search.get("start")) ?? href}
    />
  );
}
