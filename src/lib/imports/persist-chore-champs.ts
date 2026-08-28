import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  planChoreChampsImport,
  type ChoreChampsImportPlan,
} from "./chore-champs";

const SOURCE_APP = "chore-champs";

type ImportSummary = {
  created: Record<string, number>;
  reused: Record<string, number>;
  skipped: Array<{ sourceModel: string; sourceId: string; reason: string }>;
};

function increment(bucket: Record<string, number>, model: string) {
  bucket[model] = (bucket[model] ?? 0) + 1;
}

export async function importChoreChamps(
  input: unknown,
  options: {
    familyId: string;
    startedBy: string;
    kidToUserId: Readonly<Record<string, string>>;
    dryRun?: boolean;
  },
): Promise<{
  plan: ChoreChampsImportPlan;
  summary: ImportSummary;
  jobId: string | null;
}> {
  const plan = planChoreChampsImport(input, options.kidToUserId);
  const summary: ImportSummary = {
    created: {},
    reused: {},
    skipped: [
      ...plan.skippedAssignments.map((item) => ({
        sourceModel: "ChoreAssignment",
        ...item,
      })),
      ...plan.skippedRecords,
    ],
  };

  if (options.dryRun !== false) return { plan, summary, jobId: null };
  if (!prisma) throw new Error("Database is not configured");

  const job = await prisma.importJob.create({
    data: {
      family_id: options.familyId,
      source_app: SOURCE_APP,
      source_version: plan.sourceVersion,
      status: "running",
      dry_run: false,
      started_by: options.startedBy,
    },
  });

  try {
    await prisma.$transaction(
      async (tx) => {
        const prior = await tx.importedRecord.findMany({
          where: { family_id: options.familyId, source_app: SOURCE_APP },
        });
        const mappings = new Map(
          prior.map((record) => [
            `${record.source_model}:${record.source_id}`,
            record.target_id,
          ]),
        );

        const track = async (
          sourceModel: string,
          sourceId: string,
          targetModel: string,
          targetId: string,
        ) => {
          await tx.importedRecord.create({
            data: {
              family_id: options.familyId,
              import_job_id: job.id,
              source_app: SOURCE_APP,
              source_model: sourceModel,
              source_id: sourceId,
              target_model: targetModel,
              target_id: targetId,
            },
          });
          mappings.set(`${sourceModel}:${sourceId}`, targetId);
        };

        for (const source of plan.chores) {
          const key = `Chore:${source.sourceId}`;
          if (mappings.has(key)) {
            increment(summary.reused, "Chore");
            continue;
          }
          const firstAssignment = plan.assignments.find(
            (item) => item.sourceChoreId === source.sourceId,
          );
          if (!firstAssignment) {
            summary.skipped.push({
              sourceModel: "Chore",
              sourceId: source.sourceId,
              reason: "No assignment with a mapped Family Planner user",
            });
            continue;
          }
          const target = await tx.chore.create({
            data: {
              family_id: options.familyId,
              title: source.title,
              description: source.description,
              points: source.points,
              assigned_to: firstAssignment.targetUserId,
              due_date: firstAssignment.dueDate,
              status: source.active ? "pending" : "archived",
              frequency: source.frequency,
              difficulty: source.difficulty,
              created_by: options.startedBy,
              created_at: source.createdAt,
            },
          });
          await track("Chore", source.sourceId, "Chore", target.id);
          increment(summary.created, "Chore");
        }

        for (const source of plan.assignments) {
          const key = `ChoreAssignment:${source.sourceId}`;
          if (mappings.has(key)) {
            increment(summary.reused, "ChoreAssignment");
            continue;
          }
          const choreId = mappings.get(`Chore:${source.sourceChoreId}`);
          if (!choreId) {
            summary.skipped.push({
              sourceModel: "ChoreAssignment",
              sourceId: source.sourceId,
              reason: `No imported chore ${source.sourceChoreId}`,
            });
            continue;
          }
          const target = await tx.choreAssignment.create({
            data: {
              family_id: options.familyId,
              chore_id: choreId,
              assigned_to: source.targetUserId,
              due_date: source.dueDate,
              status: source.status,
              completed_at: source.completedAt,
              completed_by: source.completedAt ? source.targetUserId : null,
              idempotency_key: source.idempotencyKey,
              created_at: source.createdAt,
            },
          });
          await track(
            "ChoreAssignment",
            source.sourceId,
            "ChoreAssignment",
            target.id,
          );
          increment(summary.created, "ChoreAssignment");
        }

        for (const source of plan.habits) {
          const key = `Habit:${source.sourceId}`;
          if (mappings.has(key)) {
            increment(summary.reused, "Habit");
            continue;
          }
          const target = await tx.habit.create({
            data: {
              family_id: options.familyId,
              title: source.title,
              description: source.description,
              icon: source.icon,
              points: source.points,
              is_active: source.active,
              created_by: options.startedBy,
              created_at: source.createdAt,
            },
          });
          await track("Habit", source.sourceId, "Habit", target.id);
          increment(summary.created, "Habit");
        }

        for (const source of plan.habitLogs) {
          const key = `HabitLog:${source.sourceId}`;
          if (mappings.has(key)) {
            increment(summary.reused, "HabitLog");
            continue;
          }
          const habitId = mappings.get(`Habit:${source.sourceHabitId}`);
          if (!habitId) {
            summary.skipped.push({
              sourceModel: "HabitLog",
              sourceId: source.sourceId,
              reason: `No imported habit ${source.sourceHabitId}`,
            });
            continue;
          }
          const target = await tx.habitLog.create({
            data: {
              family_id: options.familyId,
              habit_id: habitId,
              user_id: source.targetUserId,
              logged_date: source.loggedDate,
              logged_at: source.loggedAt,
            },
          });
          await track("HabitLog", source.sourceId, "HabitLog", target.id);
          increment(summary.created, "HabitLog");
        }

        for (const source of plan.rewards) {
          const key = `Reward:${source.sourceId}`;
          if (mappings.has(key)) {
            increment(summary.reused, "Reward");
            continue;
          }
          const target = await tx.reward.create({
            data: {
              family_id: options.familyId,
              name: source.name,
              description: source.description,
              icon: source.icon,
              cost: source.cost,
              is_active: source.active,
              created_by: options.startedBy,
              created_at: source.createdAt,
            },
          });
          await track("Reward", source.sourceId, "Reward", target.id);
          increment(summary.created, "Reward");
        }

        for (const source of plan.redemptions) {
          const key = `Redemption:${source.sourceId}`;
          if (mappings.has(key)) {
            increment(summary.reused, "RewardRedemption");
            continue;
          }
          const rewardId = mappings.get(`Reward:${source.sourceRewardId}`);
          if (!rewardId) {
            summary.skipped.push({
              sourceModel: "Redemption",
              sourceId: source.sourceId,
              reason: `No imported reward ${source.sourceRewardId}`,
            });
            continue;
          }
          const target = await tx.rewardRedemption.create({
            data: {
              family_id: options.familyId,
              reward_id: rewardId,
              requested_by: source.targetUserId,
              points: source.points,
              status: "fulfilled",
              requested_at: source.requestedAt,
              fulfilled_at: source.requestedAt,
            },
          });
          await track(
            "Redemption",
            source.sourceId,
            "RewardRedemption",
            target.id,
          );
          increment(summary.created, "RewardRedemption");
        }

        for (const source of plan.familyGoals) {
          const key = `FamilyGoal:${source.sourceId}`;
          if (mappings.has(key)) {
            increment(summary.reused, "FamilyGoal");
            continue;
          }
          const target = await tx.familyGoal.create({
            data: {
              family_id: options.familyId,
              title: source.title,
              description: source.description,
              target_points: source.targetPoints,
              current_points: source.currentPoints,
              reward: source.reward,
              is_active: source.active,
              created_by: options.startedBy,
              created_at: source.createdAt,
            },
          });
          await track("FamilyGoal", source.sourceId, "FamilyGoal", target.id);
          increment(summary.created, "FamilyGoal");
        }

        for (const source of plan.badges) {
          const key = `BadgeDefinition:${source.sourceId}`;
          if (mappings.has(key)) {
            increment(summary.reused, "BadgeDefinition");
            continue;
          }
          const target = await tx.badgeDefinition.create({
            data: {
              family_id: options.familyId,
              name: source.name,
              description: source.description,
              icon: source.icon,
              requirement: source.requirement as Prisma.InputJsonValue,
              created_at: source.createdAt,
            },
          });
          await track(
            "BadgeDefinition",
            source.sourceId,
            "BadgeDefinition",
            target.id,
          );
          increment(summary.created, "BadgeDefinition");
        }

        for (const source of plan.earnedBadges) {
          const key = `EarnedBadge:${source.sourceId}`;
          if (mappings.has(key)) {
            increment(summary.reused, "EarnedBadge");
            continue;
          }
          const badgeId = mappings.get(
            `BadgeDefinition:${source.sourceBadgeId}`,
          );
          if (!badgeId) {
            summary.skipped.push({
              sourceModel: "EarnedBadge",
              sourceId: source.sourceId,
              reason: `No imported badge ${source.sourceBadgeId}`,
            });
            continue;
          }
          const target = await tx.earnedBadge.create({
            data: {
              family_id: options.familyId,
              badge_id: badgeId,
              user_id: source.targetUserId,
              earned_at: source.earnedAt,
            },
          });
          await track("EarnedBadge", source.sourceId, "EarnedBadge", target.id);
          increment(summary.created, "EarnedBadge");
        }

        await tx.importJob.update({
          where: { id: job.id },
          data: {
            status: "completed",
            completed_at: new Date(),
            summary: summary as Prisma.InputJsonValue,
          },
        });
      },
      { timeout: 60_000 },
    );
  } catch (error) {
    await prisma.importJob.update({
      where: { id: job.id },
      data: {
        status: "failed",
        completed_at: new Date(),
        error:
          error instanceof Error ? error.message : "Unknown import failure",
      },
    });
    throw error;
  }

  return { plan, summary, jobId: job.id };
}
