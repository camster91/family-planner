import { z } from "zod";
import {
  normalizePersonalLayout,
  type PersonalLayout,
  type TodayLayout,
} from "@/lib/personal-layout";
import { FEATURE_FLAG_META, type FeatureKey } from "@/lib/feature-flags";
import { featureNavMeta } from "@/lib/feature-nav-meta";
import { canRoleAccessPath } from "@/lib/kid-access";
import {
  favoritesSchema,
  todayLayoutSchema,
} from "@/lib/display-preferences-layout-schema";

export {
  favoritesSchema,
  todayLayoutSchema,
} from "@/lib/display-preferences-layout-schema";
export { displaySnapshotSchema } from "@/lib/display-preferences-snapshot-schema";
export type { DisplaySnapshot } from "@/lib/display-preferences-snapshot-schema";

const featureKeys = FEATURE_FLAG_META.map((feature) => feature.key) as [
  FeatureKey,
  ...FeatureKey[],
];
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
