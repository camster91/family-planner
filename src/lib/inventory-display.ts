/** Pure inventory display data and expiry rules shared by APIs and read-only tiles. */
import { parseDateOnly, toDateOnlyUTC } from "@/lib/dates";

export const INVENTORY_LOCATIONS = ["fridge", "freezer", "pantry"] as const;
export type InventoryLocation = (typeof INVENTORY_LOCATIONS)[number];

export const LOCATION_LABELS: Record<InventoryLocation, string> = {
  fridge: "Fridge",
  freezer: "Freezer",
  pantry: "Pantry",
};

/**
 * What an item's date means (#158). `best_before`: quality, the food may
 * still be fine after it. `use_by`: safety, do not eat it after the day.
 */
export const DATE_KINDS = ["best_before", "use_by"] as const;
export type DateKind = (typeof DATE_KINDS)[number];
export const DATE_KIND_LABELS: Record<DateKind, string> = {
  best_before: "Best before",
  use_by: "Use by",
};
export function asDateKind(value: string | null | undefined): DateKind {
  return value === "use_by" ? "use_by" : "best_before";
}

/** "Use soon" window when the caller does not pass one. */
export const DEFAULT_USE_SOON_DAYS = 3;

/** Whole days from `from` to `to` (both UTC-midnight dates). */
export function dayDiff(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

/**
 * `expired`: a best-before day has passed (check it; it still counts as "use
 * soon"). `past_use_by`: a use-by day has passed (do not eat; never "use
 * soon"). `today` / `soon` (within `days`) / `later` / `none` (no date).
 */
export type ExpiryStatus =
  "expired" | "past_use_by" | "today" | "soon" | "later" | "none";

/**
 * Where an item's date sits relative to `today`. `soon` is within `days`
 * (tomorrow up to today + days). A passed use-by day is `past_use_by`, a
 * passed best-before day `expired`. Always shown with words, never colour alone.
 */
export function expiryStatus(
  expiresOn: Date | string | null | undefined,
  today: Date,
  days: number = DEFAULT_USE_SOON_DAYS,
  dateKind: DateKind | string | null = "best_before",
): { status: ExpiryStatus; daysLeft: number | null } {
  if (!expiresOn) return { status: "none", daysLeft: null };
  const day = parseDateOnly(toDateOnlyUTC(expiresOn));
  if (!day) return { status: "none", daysLeft: null };
  const daysLeft = dayDiff(today, day);
  if (daysLeft < 0)
    return {
      status: asDateKind(dateKind) === "use_by" ? "past_use_by" : "expired",
      daysLeft,
    };
  if (daysLeft === 0) return { status: "today", daysLeft };
  if (daysLeft <= days) return { status: "soon", daysLeft };
  return { status: "later", daysLeft };
}

/**
 * Words for an item's date; best-before and use-by are never conflated.
 * Best before: "Best before was 2 days ago", "Best before today",
 * "Best before tomorrow", "Best before in 3 days".
 * Use by: "Past use-by — don't eat", "Use by today", "Use by tomorrow",
 * "Use within 3 days".
 */
export function expiryLabel(
  status: ExpiryStatus,
  daysLeft: number | null,
  dateKind: DateKind | string | null = "best_before",
): string {
  if (status === "none" || daysLeft === null) return "No date";
  if (status === "past_use_by") return "Past use-by — don't eat";
  const useBy = asDateKind(dateKind) === "use_by";
  if (status === "expired") {
    const ago = -daysLeft;
    return ago === 1
      ? "Best before was yesterday"
      : `Best before was ${ago} days ago`;
  }
  if (status === "today") return useBy ? "Use by today" : "Best before today";
  if (daysLeft === 1) return useBy ? "Use by tomorrow" : "Best before tomorrow";
  return useBy
    ? `Use within ${daysLeft} days`
    : `Best before in ${daysLeft} days`;
}

/** Statuses that belong in "use soon": a passed best-before, today, or soon. */
export function isUseSoonStatus(
  status: ExpiryStatus,
): status is "expired" | "today" | "soon" {
  return status === "expired" || status === "today" || status === "soon";
}
