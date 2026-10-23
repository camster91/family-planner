/** Foreground recovery of explicit once-only intent, never adoption of legacy once rows. */
import type { Prisma, PrismaClient } from "@prisma/client";
import { lockHousehold } from "@/lib/household-lock";
import { isRoutineScheduleExpansionEnabled } from "@/lib/routine-schedule-gates";
import { isProfileChoreEnabled } from "@/lib/profile-chore-gates";
import { normalizeFeatures, isFeatureEnabled } from "@/lib/features";
import { routineStepSeriesConfig } from "@/lib/routine-schedule";
import { log, describeError } from "@/lib/logger";
type Expand = (
  tx: Prisma.TransactionClient,
  rootId: string,
  familyId: string,
  now: Date,
) => Promise<number>;
/** Separate 100-root budget; repeating-template capacity cannot starve explicit once work. */
export const MAX_ONCE_ROUTINES_PER_TOP_UP = 100;
export async function topUpScheduledOnceSteps(
  db: Pick<PrismaClient, "$transaction">,
  familyId: string,
  now: Date,
  expand: Expand,
): Promise<number> {
  if (!isRoutineScheduleExpansionEnabled()) return 0;
  try {
    return await db.$transaction(
      async (tx) => {
        await lockHousehold(tx, familyId);
        const family = await tx.family.findUnique({
          where: { id: familyId },
          select: { features: true },
        });
        if (
          !family ||
          !isFeatureEnabled(normalizeFeatures(family.features), "chores") ||
          !isRoutineScheduleExpansionEnabled()
        )
          return 0;
        const profiles = isProfileChoreEnabled();
        const roots = await tx.$queryRaw<
          { id: string; routine_series_config: unknown }[]
        >`
        SELECT c."id", c."routine_series_config" FROM "Chore" c
        WHERE c."family_id" = ${familyId} AND c."recurrence_id" = c."id"
          AND c."routine_series_config"->>'protocol' = 'herewoven.routine-step-series.v1'
          AND c."routine_series_config"->>'state' = 'active'
          AND c."routine_series_config"->'schedule'->>'frequency' = 'once'
          AND c."routine_series_config"->>'once_pending' = 'true' 
          AND (
            (c."routine_series_config"->'content'->'subject'->>'kind' = 'account' AND EXISTS (
              SELECT 1 FROM "User" u WHERE u."id" = c."routine_series_config"->'content'->'subject'->>'user_id' AND u."family_id" = c."family_id"))
            OR (${profiles} AND c."routine_series_config"->'content'->'subject'->>'kind' = 'profile' AND EXISTS (
              SELECT 1 FROM "HouseholdMember" m WHERE m."id" = c."routine_series_config"->'content'->'subject'->>'member_id'
                AND m."family_id" = c."family_id" AND m."archived_at" IS NULL AND m."erasure_user_id" IS NULL
                AND NOT EXISTS (SELECT 1 FROM "HouseholdMemberLegacyMapping" lm WHERE lm."member_id" = m."id")
                AND NOT EXISTS (SELECT 1 FROM "HouseholdMemberAccountLink" al WHERE al."member_id" = m."id")))
          )
        ORDER BY GREATEST(c."routine_series_config"->'schedule'->>'starts_on', c."routine_series_config"->>'effective_on'), c."id"
        LIMIT ${MAX_ONCE_ROUTINES_PER_TOP_UP}`;
        let inserted = 0;
        for (const root of roots) {
          const parsed = routineStepSeriesConfig.safeParse(
            root.routine_series_config,
          );
          if (
            !parsed.success ||
            parsed.data.state !== "active" ||
            parsed.data.schedule.frequency !== "once" ||
            parsed.data.content.subject.kind === "erased" ||
            !parsed.data.once_pending
          )
            continue;
          if (!isRoutineScheduleExpansionEnabled()) continue;
          // The canonical effect re-reads root/stack/subject and never recreates
          // an occupied day, finished/evidence row, missed day or unknown version.
          // It also settles the checkpoint when the slot already exists or passed.
          inserted += await expand(tx, root.id, familyId, now);
        }
        return inserted;
      },
      { timeout: 30000 },
    );
  } catch (caught) {
    log.warn("chores.scheduled_once_top_up_failed", describeError(caught));
    return 0;
  }
}
