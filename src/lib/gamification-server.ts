import { prisma } from './prisma'
import { calculateChoreXP, xpForNextLevel } from './gamification'

export * from './gamification'

// Award XP to a user when their chore is verified
export async function awardChoreXP(
  userId: string,
  difficulty: string,
  points: number = 10
): Promise<{ xpGained: number; newXp: number; newLevel: number; levelUp: boolean; streak: number; bestStreak: number }> {
  const user = await prisma!.user.findUnique({ where: { id: userId } })
  if (!user) {
    throw new Error('User not found')
  }

  const now = new Date()
  const lastDate = user.last_chore_date
  let newStreak = 1

  if (lastDate) {
    const hoursSince = (now.getTime() - lastDate.getTime()) / (1000 * 60 * 60)
    if (hoursSince <= 48) {
      newStreak = (user.streak || 0) + 1
    }
  }

  const bestStreak = Math.max(newStreak, user.best_streak || 0)
  const xpGained = calculateChoreXP(difficulty, user.streak || 0, points)
  const newXp = (user.xp || 0) + xpGained

  let newLevel = user.level || 1
  let levelUp = false
  const needed = xpForNextLevel(newLevel)
  if (newXp >= needed) {
    newLevel += 1
    levelUp = true
  }

  await prisma!.user.update({
    where: { id: userId },
    data: {
      xp: newXp,
      level: newLevel,
      streak: newStreak,
      best_streak: bestStreak,
      last_chore_date: now,
    },
  })

  return { xpGained, newXp, newLevel, levelUp, streak: newStreak, bestStreak }
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
