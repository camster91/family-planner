/** Shared-schedule title only, after the board has resolved its visible tasks.
 * This grants no person/profile actor, private plan read or mutation authority.
 */
import type { Prisma } from "@prisma/client";
import { memberIdentityIdSchema as id } from "@/lib/member-subject-contract";
import { isProfileChoreEnabled } from "@/lib/profile-chore-gates";
import { normalizeFeatures, isFeatureEnabled } from "@/lib/features";
import { eventPreparationReady } from "./owner";
import { eventPreparationStorageAvailable } from "./storage";
export type SharedPreparationContext = Record<string, { eventTitle: string }>;
export async function readSharedPreparationContext(
  db: Pick<Prisma.TransactionClient, "$queryRaw">,
  input: { familyId: string; memberProtocol: 1 | 2; visibleChoreIds: string[] },
): Promise<SharedPreparationContext> {
  if (!eventPreparationReady()) return {};
  const ids = [...new Set(input.visibleChoreIds)]
    .filter((value) => id.safeParse(value).success)
    .slice(0, 80);
  if (!ids.length || !(await eventPreparationStorageAvailable(db))) return {};
  const profile = input.memberProtocol === 2 && isProfileChoreEnabled();
  const rows = await db.$queryRaw<
    Array<{ chore_id: string; event_title: string; features: unknown }>
  >`
    SELECT c."id" AS chore_id,e."title" AS event_title,f."features"
    FROM "EventPreparationStep" s
    JOIN "EventPreparation" p ON p."id"=s."preparation_id" AND p."family_id"=s."family_id"
    JOIN "Chore" c ON c."id"=s."chore_id" AND c."family_id"=s."family_id"
    JOIN "Event" e ON e."id"=p."event_id" AND e."family_id"=p."family_id"
    JOIN "Family" f ON f."id"=p."family_id"
    WHERE p."family_id"=${input.familyId}
      AND c."id" IN (SELECT jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))
      AND c."member_subject_erased"=false AND c."is_template"=false
      AND (
        (c."assigned_member_id" IS NULL AND EXISTS(SELECT 1 FROM "User" u WHERE u."id"=c."assigned_to" AND u."family_id"=c."family_id"))
        OR (${profile} AND c."assigned_to" IS NULL AND EXISTS(
          SELECT 1 FROM "HouseholdMember" m WHERE m."id"=c."assigned_member_id" AND m."family_id"=c."family_id"
            AND m."archived_at" IS NULL AND m."erasure_user_id" IS NULL
            AND m."role" IN ('child','teen','parent')
            AND (m."age" IS NULL OR (m."role"='child' AND m."age" BETWEEN 0 AND 17)
              OR (m."role"='teen' AND m."age" BETWEEN 13 AND 17) OR (m."role"='parent' AND m."age" BETWEEN 18 AND 120))
            AND NOT EXISTS(SELECT 1 FROM "HouseholdMemberLegacyMapping" lm WHERE lm."member_id"=m."id")
            AND NOT EXISTS(SELECT 1 FROM "HouseholdMemberAccountLink" al WHERE al."member_id"=m."id")
        ))
      )
    ORDER BY c."id" LIMIT 80`;
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
