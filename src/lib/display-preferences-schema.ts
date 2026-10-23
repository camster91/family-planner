import { z } from "zod";
import {
  TODAY_SECTIONS,
  normalizePersonalLayout,
  type PersonalLayout,
  type TodayLayout,
} from "@/lib/personal-layout";
import { FEATURE_FLAG_META, type FeatureKey } from "@/lib/feature-flags";
import { featureNavMeta } from "@/lib/feature-nav-meta";
import { canRoleAccessPath } from "@/lib/kid-access";

const featureKeys = FEATURE_FLAG_META.map((feature) => feature.key) as [
  FeatureKey,
  ...FeatureKey[],
];
const section = z.enum(TODAY_SECTIONS);
export const todayLayoutSchema = z
  .object({
    order: z
      .array(section)
      .length(TODAY_SECTIONS.length)
      .refine((items) => new Set(items).size === items.length),
    hidden: z
      .array(section)
      .max(TODAY_SECTIONS.length - 1)
      .refine(
        (items) =>
          !items.includes("next") && new Set(items).size === items.length,
      ),
    density: z.enum(["comfortable", "compact"]),
    includeChores: z.boolean(),
    calendarView: z.enum(["day", "week", "agenda", "month"]),
  })
  .strict();
const favoritesSchema = z
  .array(z.enum(featureKeys))
  .max(8)
  .refine((items) => new Set(items).size === items.length);
export const personalDisplayRecordSchema = z
  .object({
    version: z.literal(1),
    today: todayLayoutSchema.optional(),
    favorites: favoritesSchema.optional(),
    quiet: z.boolean().optional(),
  })
  .strict();
export type PersonalDisplayRecord = z.infer<typeof personalDisplayRecordSchema>;
export const displayPatchSchema = z
  .object({
    expectedRevision: z.number().int().min(0).max(2_000_000_000),
    today: todayLayoutSchema.optional(),
    favorites: favoritesSchema.optional(),
    quiet: z.boolean().optional(),
    inheritToday: z.literal(true).optional(),
  })
  .strict()
  .refine(
    (body) =>
      body.today !== undefined ||
      body.favorites !== undefined ||
      body.quiet !== undefined ||
      body.inheritToday === true,
  )
  .refine((body) => !(body.today && body.inheritToday));
export const defaultsPatchSchema = z
  .object({
    expectedRevision: z.number().int().min(0).max(2_000_000_000),
    today: todayLayoutSchema,
  })
  .strict();
export const householdDisplayRecordSchema = z
  .object({ version: z.literal(1), today: todayLayoutSchema })
  .strict();
export const displaySnapshotSchema = z
  .object({
    version: z.literal(1),
    revision: z.number().int().min(0),
    defaultsRevision: z.number().int().min(0),
    layout: z
      .object({
        today: todayLayoutSchema,
        favorites: z.array(z.string()).max(8),
      })
      .strict(),
    quiet: z.boolean(),
    defaultToday: todayLayoutSchema,
    personalizedToday: z.boolean(),
    canManageDefaults: z.boolean(),
  })
  .strict();
export type DisplaySnapshot = z.infer<typeof displaySnapshotSchema>;
export function permittedFavorites(
  favorites: readonly string[],
  role: string,
): FeatureKey[] {
  return favorites.filter((key): key is FeatureKey => {
    if (!featureKeys.includes(key as FeatureKey)) return false;
    const meta = featureNavMeta(key as FeatureKey);
    return Boolean(meta && canRoleAccessPath(role, meta.href));
  });
}
export function effectivePersonalLayout(
  record: PersonalDisplayRecord,
  defaults: TodayLayout,
  role: string,
): PersonalLayout {
  return normalizePersonalLayout({
    today: record.today ?? defaults,
    favorites: permittedFavorites(record.favorites ?? [], role),
  });
}
