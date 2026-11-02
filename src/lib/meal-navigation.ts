import { parseDateOnly } from "@/lib/dates";

/** A requested portion count is an editable draft, never a recipe update. */
export function recipeReuseServings(raw: string | null): number | undefined {
  if (!raw || !/^[1-9]\d{0,2}$/.test(raw)) return undefined;
  const value = Number(raw);
  return value <= 100 ? value : undefined;
}

/** Carry a calendar day to the existing meal screens, never an instant. */
export function mealDayHref(
  href: string | null,
  day: string | null | undefined,
): string | null {
  if (!href || !day || !parseDateOnly(day)) return href;
  const origin = "https://herewoven.invalid";
  try {
    const target = new URL(href, origin);
    if (
      target.origin !== origin ||
      (target.pathname !== "/dashboard/meals" &&
        !target.pathname.startsWith("/dashboard/meals/"))
    ) return href;
    target.searchParams.set("start", day);
    return `${target.pathname}?${target.searchParams.toString()}${target.hash}`;
  } catch {
    return href;
  }
}
