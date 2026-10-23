import { array, boolean, enum as zEnum, object } from "zod/v4";
import { TODAY_SECTIONS, type TodayLayout } from "@/lib/personal-layout";
import { FEATURE_FLAG_META, type FeatureKey } from "@/lib/feature-flags";

const featureKeys = FEATURE_FLAG_META.map((feature) => feature.key) as [
  FeatureKey,
  ...FeatureKey[],
];
const section = zEnum(TODAY_SECTIONS);

/** The canonical personal Today layout contract shared by API and clients. */
export const todayLayoutSchema = object({
  order: array(section)
    .length(TODAY_SECTIONS.length)
    .refine((items) => new Set(items).size === items.length),
  hidden: array(section)
    .max(TODAY_SECTIONS.length - 1)
    .refine(
      (items) =>
        !items.includes("next") && new Set(items).size === items.length,
    ),
  density: zEnum(["comfortable", "compact"]),
  includeChores: boolean(),
  calendarView: zEnum(["day", "week", "agenda", "month"]),
}).strict();

export const favoritesSchema = array(zEnum(featureKeys))
  .max(8)
  .refine((items) => new Set(items).size === items.length);

export type { TodayLayout };
