import type { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { calculateChoreXP, xpForNextLevel } from './gamification'

export * from './gamification'

export type AwardChoreXPResult = {
  xpGained: number
  newXp: number
  newLevel: number
  levelUp: boolean
  streak: number
  bestStreak: number
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Whole calendar days between two instants, compared as UTC dates only.
 *
 * The streak is a calendar-day streak: what matters is WHICH day each chore
 * was verified on, not how many hours apart. UTC is used deliberately — the
 * server has no per-user time zone, and UTC is stable regardless of where the
 * process runs. A family near a UTC day boundary may therefore see "today"
 * roll over at a local time other than midnight; that is accepted.
 */
export function utcDayDiff(from: Date, to: Date): number {
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate())
  return Math.round((b - a) / MS_PER_DAY)
}

/**
 * Next streak value for a chore verified at `now`.
 *
 *   - same UTC day as the last verified chore -> unchanged (at least 1)
 *   - the previous UTC day                    -> +1
 *   - anything older, or no previous chore    -> reset to 1
 *
 * Previously every verified chore within 48h added 1, so verifying five chores
 * in one afternoon counted as a five-day streak.
 */
export function nextStreak(previousStreak: number, lastChoreDate: Date | null, now: Date): number {
  if (!lastChoreDate) return 1
  const days = utcDayDiff(lastChoreDate, now)
  // days < 0 only under clock skew; treat it as the same day.
  if (days <= 0) return Math.max(previousStreak, 1)
  if (days === 1) return previousStreak + 1
  return 1
}

/** Level implied by an XP total, never lower than the current level. */
export function levelForXp(xp: number, currentLevel: number): number {
  let level = Math.max(currentLevel, 1)
  while (xp >= xpForNextLevel(level)) level += 1
  return level
}

async function awardChoreXPInTx(
  tx: Prisma.TransactionClient,
  userId: string,
  difficulty: string,
  points: number
): Promise<AwardChoreXPResult> {
  // Lock the user row for the rest of the transaction. XP itself is written as
  // an atomic increment, but streak/best_streak/level are derived from the row
  // we read, so two concurrent awards must not both read the same snapshot.
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`

  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { streak: true, best_streak: true, last_chore_date: true },
  })
  if (!user) {
    throw new Error('User not found')
  }

  const now = new Date()
  const newStreak = nextStreak(user.streak || 0, user.last_chore_date, now)
  const bestStreak = Math.max(newStreak, user.best_streak || 0)
  const xpGained = calculateChoreXP(difficulty, user.streak || 0, points)

  // Increment, never write an absolute value: rewards/claim decrements xp
  // concurrently, and an absolute write computed from a stale read would undo
  // that deduction (a double spend).
  const updated = await tx.user.update({
    where: { id: userId },
    data: {
      xp: { increment: xpGained },
      streak: newStreak,
      best_streak: bestStreak,
      last_chore_date: now,
    },
    select: { xp: true, level: true },
  })

  const oldLevel = updated.level || 1
  const newLevel = levelForXp(updated.xp || 0, oldLevel)
  if (newLevel !== oldLevel) {
    await tx.user.update({ where: { id: userId }, data: { level: newLevel } })
  }

  return {
    xpGained,
    newXp: updated.xp || 0,
    newLevel,
    levelUp: newLevel > oldLevel,
    streak: newStreak,
    bestStreak,
  }
}

/**
 * Award XP to a user when their chore is verified.
 *
 * Pass `tx` to run inside the caller's transaction (so e.g. the verify status
 * change and the award commit or roll back together); otherwise the award runs
 * in its own transaction.
 */
export async function awardChoreXP(
  userId: string,
  difficulty: string,
  points: number = 10,
  tx?: Prisma.TransactionClient
): Promise<AwardChoreXPResult> {
  if (tx) return awardChoreXPInTx(tx, userId, difficulty, points)
  return prisma!.$transaction((t) => awardChoreXPInTx(t, userId, difficulty, points))
}

export async function getFamilyLeaderboard(familyId: string) {
  const members = await prisma!.user.findMany({
    where: { family_id: familyId },
    orderBy: { xp: 'desc' },
    select: { id: true, name: true, xp: true, level: true, streak: true, best_streak: true, avatar_url: true, role: true },
  })

  return members.map((m, i) => ({
    rank: i + 1,
    id: m.id,
    name: m.name,
    xp: m.xp || 0,
    level: m.level || 1,
    streak: m.streak || 0,
    bestStreak: m.best_streak || 0,
    avatar: m.avatar_url,
    role: m.role,
  }))
}
