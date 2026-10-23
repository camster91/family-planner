import { z } from "zod/mini";
import { TODAY_SECTIONS, type TodayLayout } from "@/lib/personal-layout";
import { FEATURE_FLAG_META, type FeatureKey } from "@/lib/feature-flags";

const featureKeys = FEATURE_FLAG_META.map((feature) => feature.key) as [
  FeatureKey,
  ...FeatureKey[],
];
const section = z.enum(TODAY_SECTIONS);

/** The canonical personal Today layout contract shared by API and clients. */
export const todayLayoutSchema = z.strictObject({
  order: z.array(section).check(
    z.length(TODAY_SECTIONS.length),
    z.refine((items) => new Set(items).size === items.length),
  ),
  hidden: z.array(section).check(
    z.maxLength(TODAY_SECTIONS.length - 1),
    z.refine(
      (items) =>
        !items.includes("next") && new Set(items).size === items.length,
    ),
  ),
  density: z.enum(["comfortable", "compact"]),
  includeChores: z.boolean(),
  calendarView: z.enum(["day", "week", "agenda", "month"]),
});

export const favoritesSchema = z.array(z.enum(featureKeys)).check(
  z.maxLength(8),
  z.refine((items) => new Set(items).size === items.length),
);

export type { TodayLayout };
