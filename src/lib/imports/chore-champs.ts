import { z } from "zod";

const dateValue = z
  .union([z.string(), z.date()])
  .transform((value, context) => {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid date",
      });
      return z.NEVER;
    }
    return date;
  });

export const choreChampsExportSchema = z.object({
  version: z.string().min(1),
  family: z.object({ id: z.string().min(1), name: z.string().min(1) }),
  kids: z.array(z.object({ id: z.string().min(1), name: z.string().min(1) })),
  chores: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      description: z.string().nullish(),
      basePoints: z.number().int().nonnegative().default(5),
      difficulty: z.string().default("EASY"),
      recurring: z.string().nullish(),
      isActive: z.boolean().default(true),
      createdAt: dateValue,
    }),
  ),
  assignments: z.array(
    z.object({
      id: z.string().min(1),
      choreId: z.string().min(1),
      kidId: z.string().min(1),
      dueDate: dateValue,
      status: z.string().default("PENDING"),
      completedAt: dateValue.nullish(),
      createdAt: dateValue,
    }),
  ),
  habits: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1),
        description: z.string().nullish(),
        icon: z.string().nullish(),
        points: z.number().int().nonnegative().default(5),
        isActive: z.boolean().default(true),
        createdAt: dateValue,
      }),
    )
    .default([]),
  habitLogs: z
    .array(
      z.object({
        id: z.string().min(1),
        habitId: z.string().min(1),
        kidId: z.string().min(1),
        loggedDate: dateValue,
        loggedAt: dateValue,
      }),
    )
    .default([]),
  rewards: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1),
        description: z.string().nullish(),
        cost: z.number().int().nonnegative(),
        icon: z.string().nullish(),
        isActive: z.boolean().default(true),
        createdAt: dateValue,
      }),
    )
    .default([]),
  redemptions: z
    .array(
      z.object({
        id: z.string().min(1),
        rewardId: z.string().min(1),
        kidId: z.string().min(1),
        points: z.number().int().nonnegative(),
        createdAt: dateValue,
      }),
    )
    .default([]),
  familyGoals: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1),
        description: z.string().nullish(),
        targetPoints: z.number().int().positive(),
        currentPoints: z.number().int().nonnegative(),
        reward: z.string().nullish(),
        isActive: z.boolean().default(true),
        createdAt: dateValue,
      }),
    )
    .default([]),
  badges: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        description: z.string(),
        icon: z.string(),
        requirement: z.string(),
        createdAt: dateValue,
      }),
    )
    .default([]),
  earnedBadges: z
    .array(
      z.object({
        id: z.string().min(1),
        badgeId: z.string().min(1),
        kidId: z.string().min(1),
        earnedAt: dateValue,
      }),
    )
    .default([]),
});

export type ChoreChampsExport = z.input<typeof choreChampsExportSchema>;

export interface PlannedChore {
  sourceId: string;
  title: string;
  description: string | null;
  points: number;
  difficulty: "easy" | "medium" | "hard";
  frequency: "once" | "daily" | "weekly" | "monthly";
  active: boolean;
  createdAt: Date;
}

export interface PlannedAssignment {
  sourceId: string;
  sourceChoreId: string;
  targetUserId: string;
  dueDate: Date;
  status: "pending" | "in_progress" | "completed" | "approved";
  completedAt: Date | null;
  createdAt: Date;
  idempotencyKey: string;
}

export interface ChoreChampsImportPlan {
  sourceVersion: string;
  sourceFamilyId: string;
  chores: PlannedChore[];
  assignments: PlannedAssignment[];
  skippedAssignments: Array<{ sourceId: string; reason: string }>;
  habits: Array<{
    sourceId: string;
    title: string;
    description: string | null;
    icon: string | null;
    points: number;
    active: boolean;
    createdAt: Date;
  }>;
  habitLogs: Array<{
    sourceId: string;
    sourceHabitId: string;
    targetUserId: string;
    loggedDate: Date;
    loggedAt: Date;
  }>;
  rewards: Array<{
    sourceId: string;
    name: string;
    description: string | null;
    icon: string | null;
    cost: number;
    active: boolean;
    createdAt: Date;
  }>;
  redemptions: Array<{
    sourceId: string;
    sourceRewardId: string;
    targetUserId: string;
    points: number;
    requestedAt: Date;
  }>;
  familyGoals: Array<{
    sourceId: string;
    title: string;
    description: string | null;
    targetPoints: number;
    currentPoints: number;
    reward: string | null;
    active: boolean;
    createdAt: Date;
  }>;
  badges: Array<{
    sourceId: string;
    name: string;
    description: string;
    icon: string;
    requirement: { type: "legacy"; value: string };
    createdAt: Date;
  }>;
  earnedBadges: Array<{
    sourceId: string;
    sourceBadgeId: string;
    targetUserId: string;
    earnedAt: Date;
  }>;
  skippedRecords: Array<{
    sourceModel: string;
    sourceId: string;
    reason: string;
  }>;
}

function normalizeDifficulty(value: string): PlannedChore["difficulty"] {
  switch (value.toUpperCase()) {
    case "HARD":
      return "hard";
    case "MEDIUM":
      return "medium";
    default:
      return "easy";
  }
}

function normalizeFrequency(
  value: string | null | undefined,
): PlannedChore["frequency"] {
  switch (value?.toUpperCase()) {
    case "DAILY":
      return "daily";
    case "WEEKLY":
      return "weekly";
    case "MONTHLY":
      return "monthly";
    default:
      return "once";
  }
}

function normalizeStatus(value: string): PlannedAssignment["status"] {
  switch (value.toUpperCase()) {
    case "IN_PROGRESS":
      return "in_progress";
    case "COMPLETED":
      return "completed";
    case "APPROVED":
    case "VERIFIED":
      return "approved";
    default:
      return "pending";
  }
}

export function planChoreChampsImport(
  input: unknown,
  kidToUserId: Readonly<Record<string, string>>,
): ChoreChampsImportPlan {
  const source = choreChampsExportSchema.parse(input);
  const choreIds = new Set(source.chores.map((chore) => chore.id));
  const habitIds = new Set(source.habits.map((habit) => habit.id));
  const rewardIds = new Set(source.rewards.map((reward) => reward.id));
  const badgeIds = new Set(source.badges.map((badge) => badge.id));
  const skippedAssignments: ChoreChampsImportPlan["skippedAssignments"] = [];
  const skippedRecords: ChoreChampsImportPlan["skippedRecords"] = [];

  const assignments = source.assignments.flatMap<PlannedAssignment>(
    (assignment) => {
      const targetUserId = kidToUserId[assignment.kidId];
      if (!targetUserId) {
        skippedAssignments.push({
          sourceId: assignment.id,
          reason: `No user mapping for kid ${assignment.kidId}`,
        });
        return [];
      }
      if (!choreIds.has(assignment.choreId)) {
        skippedAssignments.push({
          sourceId: assignment.id,
          reason: `Missing source chore ${assignment.choreId}`,
        });
        return [];
      }
      return [
        {
          sourceId: assignment.id,
          sourceChoreId: assignment.choreId,
          targetUserId,
          dueDate: assignment.dueDate,
          status: normalizeStatus(assignment.status),
          completedAt: assignment.completedAt ?? null,
          createdAt: assignment.createdAt,
          idempotencyKey: `chore-champs:assignment:${assignment.id}`,
        },
      ];
    },
  );

  return {
    sourceVersion: source.version,
    sourceFamilyId: source.family.id,
    chores: source.chores.map((chore) => ({
      sourceId: chore.id,
      title: chore.title.trim(),
      description: chore.description?.trim() || null,
      points: chore.basePoints,
      difficulty: normalizeDifficulty(chore.difficulty),
      frequency: normalizeFrequency(chore.recurring),
      active: chore.isActive,
      createdAt: chore.createdAt,
    })),
    assignments,
    skippedAssignments,
    habits: source.habits.map((habit) => ({
      sourceId: habit.id,
      title: habit.title.trim(),
      description: habit.description?.trim() || null,
      icon: habit.icon || null,
      points: habit.points,
      active: habit.isActive,
      createdAt: habit.createdAt,
    })),
    habitLogs: source.habitLogs.flatMap((log) => {
      const targetUserId = kidToUserId[log.kidId];
      if (!targetUserId || !habitIds.has(log.habitId)) {
        skippedRecords.push({
          sourceModel: "HabitLog",
          sourceId: log.id,
          reason: !targetUserId
            ? `No user mapping for kid ${log.kidId}`
            : `Missing source habit ${log.habitId}`,
        });
        return [];
      }
      return [
        {
          sourceId: log.id,
          sourceHabitId: log.habitId,
          targetUserId,
          loggedDate: log.loggedDate,
          loggedAt: log.loggedAt,
        },
      ];
    }),
    rewards: source.rewards.map((reward) => ({
      sourceId: reward.id,
      name: reward.title.trim(),
      description: reward.description?.trim() || null,
      icon: reward.icon || null,
      cost: reward.cost,
      active: reward.isActive,
      createdAt: reward.createdAt,
    })),
    redemptions: source.redemptions.flatMap((redemption) => {
      const targetUserId = kidToUserId[redemption.kidId];
      if (!targetUserId || !rewardIds.has(redemption.rewardId)) {
        skippedRecords.push({
          sourceModel: "Redemption",
          sourceId: redemption.id,
          reason: !targetUserId
            ? `No user mapping for kid ${redemption.kidId}`
            : `Missing source reward ${redemption.rewardId}`,
        });
        return [];
      }
      return [
        {
          sourceId: redemption.id,
          sourceRewardId: redemption.rewardId,
          targetUserId,
          points: redemption.points,
          requestedAt: redemption.createdAt,
        },
      ];
    }),
    familyGoals: source.familyGoals.map((goal) => ({
      sourceId: goal.id,
      title: goal.title.trim(),
      description: goal.description?.trim() || null,
      targetPoints: goal.targetPoints,
      currentPoints: goal.currentPoints,
      reward: goal.reward?.trim() || null,
      active: goal.isActive,
      createdAt: goal.createdAt,
    })),
    badges: source.badges.map((badge) => ({
      sourceId: badge.id,
      name: badge.name.trim(),
      description: badge.description.trim(),
      icon: badge.icon,
      requirement: { type: "legacy" as const, value: badge.requirement },
      createdAt: badge.createdAt,
    })),
    earnedBadges: source.earnedBadges.flatMap((earned) => {
      const targetUserId = kidToUserId[earned.kidId];
      if (!targetUserId || !badgeIds.has(earned.badgeId)) {
        skippedRecords.push({
          sourceModel: "EarnedBadge",
          sourceId: earned.id,
          reason: !targetUserId
            ? `No user mapping for kid ${earned.kidId}`
            : `Missing source badge ${earned.badgeId}`,
        });
        return [];
      }
      return [
        {
          sourceId: earned.id,
          sourceBadgeId: earned.badgeId,
          targetUserId,
          earnedAt: earned.earnedAt,
        },
      ];
    }),
    skippedRecords,
  };
}
