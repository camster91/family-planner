/**
 * Zod-free browser check for the display-preference read receipt consumed by
 * the dashboard preference provider. Mirrors `displaySnapshotSchema`
 * (display-preferences-snapshot-schema.ts) and its `todayLayoutSchema`, which
 * stay the server/composition contracts; parity is tested.
 */
import {
  SHAPE_FAILURE,
  arrayOf,
  isNonNegativeSafeInteger,
  isOneOf,
  shapeSuccess,
  strictRecord,
  type ShapeResult,
} from "@/lib/browser-shape";
import {
  MAX_FAVORITES,
  TODAY_SECTIONS,
  type TodayLayout,
  type TodaySection,
} from "@/lib/personal-layout";

export type DisplaySnapshot = {
  version: 1;
  revision: number;
  defaultsRevision: number;
  layout: { today: TodayLayout; favorites: string[] };
  quiet: boolean;
  defaultToday: TodayLayout;
  personalizedToday: boolean;
  canManageDefaults: boolean;
};

const DENSITIES = ["comfortable", "compact"] as const;
const CALENDAR_VIEWS = ["day", "week", "agenda", "month"] as const;

const isSection = (value: unknown): value is TodaySection =>
  isOneOf(value, TODAY_SECTIONS);
const isString = (value: unknown): value is string => typeof value === "string";
const unique = (items: readonly unknown[]) =>
  new Set(items).size === items.length;

function todayLayout(value: unknown): TodayLayout | null {
  const record = strictRecord(value, [
    "order",
    "hidden",
    "density",
    "includeChores",
    "calendarView",
  ]);
  if (!record) return null;
  const order = arrayOf(record.order, TODAY_SECTIONS.length, isSection);
  const hidden = arrayOf(record.hidden, TODAY_SECTIONS.length - 1, isSection);
  const { density, includeChores, calendarView } = record;
  if (
    !order ||
    order.length !== TODAY_SECTIONS.length ||
    !unique(order) ||
    !hidden ||
    hidden.includes("next") ||
    !unique(hidden) ||
    !isOneOf(density, DENSITIES) ||
    typeof includeChores !== "boolean" ||
    !isOneOf(calendarView, CALENDAR_VIEWS)
  )
    return null;
  return { order, hidden, density, includeChores, calendarView };
}

export function parseDisplaySnapshot(
  value: unknown,
): ShapeResult<DisplaySnapshot> {
  const record = strictRecord(value, [
    "version",
    "revision",
    "defaultsRevision",
    "layout",
    "quiet",
    "defaultToday",
    "personalizedToday",
    "canManageDefaults",
  ]);
  if (!record) return SHAPE_FAILURE;
  const layout = strictRecord(record.layout, ["today", "favorites"]);
  const today = layout && todayLayout(layout.today);
  const favorites =
    layout && arrayOf(layout.favorites, MAX_FAVORITES, isString);
  const defaultToday = todayLayout(record.defaultToday);
  const {
    version,
    revision,
    defaultsRevision,
    quiet,
    personalizedToday,
    canManageDefaults,
  } = record;
  if (
    version !== 1 ||
    !isNonNegativeSafeInteger(revision) ||
    !isNonNegativeSafeInteger(defaultsRevision) ||
    !today ||
    !favorites ||
    typeof quiet !== "boolean" ||
    !defaultToday ||
    typeof personalizedToday !== "boolean" ||
    typeof canManageDefaults !== "boolean"
  )
    return SHAPE_FAILURE;
  return shapeSuccess({
    version,
    revision,
    defaultsRevision,
    layout: { today, favorites },
    quiet,
    defaultToday,
    personalizedToday,
    canManageDefaults,
  });
}
