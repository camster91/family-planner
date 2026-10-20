import type { PrismaClient } from "@prisma/client";
import {
  routineScheduleAuthority,
  routineScheduleFailure,
  type RoutineScheduleActor,
} from "@/lib/routine-schedule-runtime";
import {
  routineScheduleConfig,
  ROUTINE_SCHEDULE_PROTOCOL,
} from "@/lib/routine-schedule";
import {
  routineScheduleCatalog,
  type RoutineAssignmentOption,
} from "@/lib/routine-schedule-view";
import { eligibleChoreAssigneeInTx } from "@/lib/chore-member-subject";
import { eligibleProfileChoreAssigneeInTx } from "@/lib/chore-profile-assignee";
import {
  isProfileChoreEnabled,
  isProfileChoreRecurrenceSupported,
} from "@/lib/profile-chore-gates";
import { HouseholdMemberIdentityConflict } from "@/lib/household-member-lifecycle";
import type { EffectResult } from "@/lib/idempotency";
/** Stable bounded pages; unavailable future protocols are visible but never editable. */
export async function readRoutineScheduleCatalog(
  db: Pick<PrismaClient, "$transaction">,
  actor: RoutineScheduleActor,
  cursor: string | null,
): Promise<EffectResult> {
  if (cursor !== null && (!cursor || cursor.length > 128))
    return { status: 400, body: { error: { code: "INVALID_QUERY" } } };
  try {
    return await db.$transaction(
      async (tx) => {
        const capabilities = await routineScheduleAuthority(tx, actor);
        const rows = await tx.$queryRaw<
          {
            id: string;
            label: string;
            version: number;
            schedule_config: unknown;
          }[]
        >`
        SELECT "id", "label", "version", "schedule_config" FROM "RoutineStack"
        WHERE "family_id" = ${actor.familyId} AND "schedule_config" IS NOT NULL AND "id" > ${cursor ?? ""}
        ORDER BY "id" ASC LIMIT 21`;
        const users = await tx.user.findMany({
          where: { family_id: actor.familyId },
          select: { id: true, name: true, role: true },
          orderBy: [{ name: "asc" }, { id: "asc" }],
          take: 1001,
        });
        const profiles =
          actor.memberProtocol === 2 && isProfileChoreEnabled()
            ? await tx.householdMember.findMany({
                where: {
                  family_id: actor.familyId,
                  archived_at: null,
                  erasure_user_id: null,
                  legacy_mapping: { is: null },
                  account_link: { is: null },
                },
                select: { id: true, name: true, role: true },
                orderBy: [{ name: "asc" }, { id: "asc" }],
                take: 1001,
              })
            : [];
        if (users.length + profiles.length > 1000)
          return {
            status: 409,
            body: { error: { code: "ROUTINE_MEMBERS_REQUIRE_REVIEW" } },
          };
        const assignments: RoutineAssignmentOption[] = [];
        for (const user of users) {
          try {
            const owner = await eligibleChoreAssigneeInTx(
              tx,
              actor.familyId,
              user.id,
            );
            if (owner)
              assignments.push({
                subject: {
                  kind: "account",
                  user_id: owner.assigned_to,
                  member_id: owner.assigned_member_id ?? null,
                },
                name: user.name,
                role: user.role,
                canRepeat: true,
              });
          } catch (caught) {
            if (!(caught instanceof HouseholdMemberIdentityConflict))
              throw caught;
          }
        }
        for (const profile of profiles) {
          if (
            await eligibleProfileChoreAssigneeInTx(
              tx,
              actor.familyId,
              profile.id,
              false,
            )
          )
            assignments.push({
              subject: { kind: "profile", member_id: profile.id },
              name: profile.name,
              role: profile.role,
              canRepeat: isProfileChoreRecurrenceSupported(),
            });
        }
        const page = rows.slice(0, 20);
        return {
          status: 200,
          body: routineScheduleCatalog.parse({
            protocol: ROUTINE_SCHEDULE_PROTOCOL,
            userId: actor.userId,
            familyId: actor.familyId,
            pointsEnabled: capabilities.pointsEnabled,
            routines: page.map((row) => {
              const config = routineScheduleConfig.safeParse(
                row.schedule_config,
              );
              return {
                stackId: row.id,
                label: row.label,
                version: row.version,
                state: config.success ? config.data.state : "unsupported",
                schedule: config.success ? config.data.schedule : null,
                stepCount: config.success ? config.data.steps.length : null,
              };
            }),
            nextCursor: rows.length > 20 ? page[page.length - 1].id : null,
            assignments,
          }),
        };
      },
      { timeout: 30_000 },
    );
  } catch (caught) {
    const refusal = routineScheduleFailure(caught);
    if (refusal) return refusal;
    throw caught;
  }
}
