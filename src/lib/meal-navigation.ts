import { parseDateOnly } from "@/lib/dates";

/** Carry a calendar day to the existing rolling-week planner, never an instant. */
export function mealDayHref(
  href: string | null,
  day: string | null | undefined,
): string | null {
  if (!href || !day || !parseDateOnly(day)) return href;
  const origin = "https://herewoven.invalid";
  try {
    const target = new URL(href, origin);
    if (target.origin !== origin || target.pathname !== "/dashboard/meals") return href;
    target.searchParams.set("start", day);
    return `${target.pathname}?${target.searchParams.toString()}${target.hash}`;
  } catch {
    return href;
  }
}
