/** Personal parent relationship projection only. Never add this map to the
 * shared/persisted board DTO. IDs are restricted to already-visible Chores;
 * the preparation read still renews all current Event/task authority on open. */
import type { Prisma } from "@prisma/client";
import { normalizeFeatures, isFeatureEnabled } from "@/lib/features";
import { memberIdentityIdSchema } from "@/lib/member-subject-contract";
import { eventPreparationReady } from "./owner";
import { eventPreparationStorageAvailable } from "./storage";
export type PreparationBacklinks = Record<string, string>;
export async function readPreparationBacklinks(
  db: Pick<Prisma.TransactionClient, "$queryRaw">,
  input: { userId: string; familyId: string; role: string; choreIds: string[] },
): Promise<PreparationBacklinks> {
  if (!eventPreparationReady() || input.role !== "parent") return {};
  // This is an entry-point projection, not an exhaustive preparation summary.
  // Limit total work even when the chore board contains a larger history.
  const ids = [...new Set(input.choreIds)]
    .filter((id) => memberIdentityIdSchema.safeParse(id).success)
    .slice(0, 300);
  if (!ids.length || !(await eventPreparationStorageAvailable(db))) return {};
  const rows = await db.$queryRaw<
    Array<{ chore_id: string; event_id: string; features: unknown }>
  >`
    SELECT c."id" AS chore_id, e."id" AS event_id, f."features"
    FROM "EventPreparationStep" s
    JOIN "EventPreparation" p ON p."id"=s."preparation_id" AND p."family_id"=s."family_id"
    JOIN "Chore" c ON c."id"=s."chore_id" AND c."family_id"=s."family_id"
    JOIN "Event" e ON e."id"=p."event_id" AND e."family_id"=p."family_id"
    JOIN "Family" f ON f."id"=p."family_id"
    WHERE p."family_id"=${input.familyId}
      AND c."id" IN (SELECT jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))
      AND c."is_template"=false
      AND EXISTS (SELECT 1 FROM "User" u WHERE u."id"=${input.userId}
        AND u."family_id"=p."family_id" AND u."role"='parent')
    ORDER BY c."id" LIMIT 300`;
  const allowed = new Set(ids);
  return Object.fromEntries(
    rows.flatMap((row) => {
      const features = normalizeFeatures(row.features);
      return allowed.has(row.chore_id) &&
        memberIdentityIdSchema.safeParse(row.event_id).success &&
        isFeatureEnabled(features, "calendar") &&
        isFeatureEnabled(features, "chores")
        ? [[row.chore_id, row.event_id]]
        : [];
    }),
  );
}

/** Account-person child/teen projection: own canonical tasks only. No profile
 * impersonation, other people's checks, plan source tokens or edit capability.
 * Event titles are the existing shared-schedule field, never private details. */
export type OwnPreparationContext = Record<string, { eventTitle: string }>;
export async function readOwnPreparationContext(
  db: Pick<Prisma.TransactionClient, "$queryRaw">,
  input: { userId: string; familyId: string; role: string; choreIds: string[] },
): Promise<OwnPreparationContext> {
  if (!eventPreparationReady() || !["child", "teen"].includes(input.role))
    return {};
  const ids = [...new Set(input.choreIds)]
    .filter((id) => memberIdentityIdSchema.safeParse(id).success)
    .slice(0, 150);
  if (!ids.length || !(await eventPreparationStorageAvailable(db))) return {};
  const rows = await db.$queryRaw<
    Array<{ chore_id: string; event_title: string; features: unknown }>
  >`
    SELECT c."id" AS chore_id, e."title" AS event_title, f."features"
    FROM "EventPreparationStep" s
    JOIN "EventPreparation" p ON p."id"=s."preparation_id" AND p."family_id"=s."family_id"
    JOIN "Chore" c ON c."id"=s."chore_id" AND c."family_id"=s."family_id"
    JOIN "Event" e ON e."id"=p."event_id" AND e."family_id"=p."family_id"
    JOIN "Family" f ON f."id"=p."family_id"
    JOIN "User" u ON u."id"=${input.userId} AND u."family_id"=p."family_id" AND u."role"=${input.role}
    WHERE p."family_id"=${input.familyId} AND u."role" IN ('child','teen')
      AND c."assigned_to"=u."id" AND c."assigned_member_id" IS NULL
      AND c."member_subject_erased"=false AND c."is_template"=false
      AND c."id" IN (SELECT jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))
    ORDER BY c."id" LIMIT 150`;
  const allowed = new Set(ids);
  return Object.fromEntries(
    rows.flatMap((row) => {
      const features = normalizeFeatures(row.features);
      return allowed.has(row.chore_id) &&
        typeof row.event_title === "string" &&
        isFeatureEnabled(features, "calendar") &&
        isFeatureEnabled(features, "chores")
        ? [[row.chore_id, { eventTitle: row.event_title.slice(0, 512) }]]
        : [];
    }),
  );
}
