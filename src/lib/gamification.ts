// Client-safe gamification utilities (no server imports)

export interface Badge {
  id: string
  name: string
  description: string
  icon: string
  criteria: string
}

const legacyBadges: Badge[] = [
  { id: 'first_chore', name: 'First Step', description: 'Complete your first chore', icon: '🌟', criteria: 'complete_1_chore' },
  { id: 'streak_3', name: 'On Fire', description: '3-day streak', icon: '🔥', criteria: '3_day_streak' },
  { id: 'streak_7', name: 'Week Warrior', description: '7-day streak', icon: '💪', criteria: '7_day_streak' },
  { id: 'points_50', name: 'Point Collector', description: 'Earn 50 points', icon: '💎', criteria: 'earn_50_points' },
]

export function getBadgeById(id: string): Badge | undefined {
  return legacyBadges.find(b => b.id === id)
}

// XP config
export const DIFFICULTY_MULTIPLIER: Record<string, number> = {
  easy: 1,
  medium: 1.5,
  hard: 2,
}

export const BASE_XP = 10

export function streakBonus(streak: number): number {
  const bonus = Math.min(streak * 0.1, 1.0)
  return 1 + bonus
}

export function xpForNextLevel(level: number): number {
  return 100 * level
}

export function calculateChoreXP(difficulty: string, streak: number): number {
  const mult = DIFFICULTY_MULTIPLIER[difficulty] || 1
  const bonus = streakBonus(streak)
  return Math.round(BASE_XP * mult * bonus)
}

// Badge rendering for client components
export interface UserBadge {
  id: string
  name: string
  description: string
  icon: string
}

export function getBadges(user: {
  xp: number
  level: number
  streak: number
  best_streak: number
}): UserBadge[] {
  const badges: UserBadge[] = []

  if ((user.xp || 0) >= 50) {
    badges.push({ id: 'points_50', name: 'Point Collector', description: 'Earn 50 XP', icon: '💎' })
  }
  if ((user.xp || 0) >= 200) {
    badges.push({ id: 'points_200', name: 'XP Hunter', description: 'Earn 200 XP', icon: '👑' })
  }
  if ((user.streak || 0) >= 3) {
    badges.push({ id: 'streak_3', name: 'On Fire', description: '3-day streak', icon: '🔥' })
  }
  if ((user.streak || 0) >= 7) {
    badges.push({ id: 'streak_7', name: 'Week Warrior', description: '7-day streak', icon: '💪' })
  }
  if ((user.best_streak || 0) >= 14) {
    badges.push({ id: 'streak_14', name: 'Unstoppable', description: '14-day best streak', icon: '⚡' })
  }
  if ((user.level || 1) >= 3) {
    badges.push({ id: 'level_3', name: 'Rising Star', description: 'Reach Level 3', icon: '🌟' })
  }
  if ((user.level || 1) >= 5) {
    badges.push({ id: 'level_5', name: 'Chore Master', description: 'Reach Level 5', icon: '🏆' })
  }

  return badges
}
