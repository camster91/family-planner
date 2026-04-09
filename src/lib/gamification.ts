// XP and leveling system
export const XP_PER_LEVEL = 100 // XP needed per level
export const MAX_LEVEL = 50

export function calculateLevel(xp: number): number {
  return Math.min(Math.floor(xp / XP_PER_LEVEL) + 1, MAX_LEVEL)
}

export function xpForNextLevel(currentXp: number): number {
  const currentLevel = calculateLevel(currentXp)
  return currentLevel * XP_PER_LEVEL - currentXp
}

export function xpProgress(currentXp: number): number {
  const currentLevel = calculateLevel(currentXp)
  const xpIntoLevel = currentXp - (currentLevel - 1) * XP_PER_LEVEL
  return Math.round((xpIntoLevel / XP_PER_LEVEL) * 100)
}

// Points awarded per difficulty
export const DIFFICULTY_XP = {
  easy: 10,
  medium: 25,
  hard: 50,
} as const

// Streak bonus multiplier
export function streakMultiplier(streak: number): number {
  if (streak >= 30) return 2.0
  if (streak >= 14) return 1.5
  if (streak >= 7) return 1.25
  if (streak >= 3) return 1.1
  return 1.0
}

// Level titles
export function getLevelTitle(level: number): string {
  if (level >= 40) return 'Legendary Helper'
  if (level >= 30) return 'Master Organizer'
  if (level >= 20) return 'Super Star'
  if (level >= 15) return 'Family Hero'
  if (level >= 10) return 'Rising Star'
  if (level >= 7) return 'Hard Worker'
  if (level >= 5) return 'Team Player'
  if (level >= 3) return 'Getting Started'
  return 'Rookie'
}

// Level color for UI
export function getLevelColor(level: number): string {
  if (level >= 40) return 'text-amber-500'
  if (level >= 30) return 'text-purple-500'
  if (level >= 20) return 'text-blue-500'
  if (level >= 10) return 'text-green-500'
  if (level >= 5) return 'text-cyan-500'
  return 'text-gray-500'
}

// Badge definitions
export interface BadgeDefinition {
  id: string
  name: string
  description: string
  icon: string // emoji
  requirement: string
}

export const BADGES: BadgeDefinition[] = [
  // Chore badges
  { id: 'first_chore', name: 'First Steps', description: 'Complete your first chore', icon: '🌟', requirement: 'Complete 1 chore' },
  { id: 'chore_10', name: 'Getting Going', description: 'Complete 10 chores', icon: '💪', requirement: 'Complete 10 chores' },
  { id: 'chore_50', name: 'Chore Champion', description: 'Complete 50 chores', icon: '🏆', requirement: 'Complete 50 chores' },
  { id: 'chore_100', name: 'Chore Legend', description: 'Complete 100 chores', icon: '👑', requirement: 'Complete 100 chores' },

  // Streak badges
  { id: 'streak_3', name: 'On a Roll', description: '3-day streak', icon: '🔥', requirement: '3-day streak' },
  { id: 'streak_7', name: 'Week Warrior', description: '7-day streak', icon: '⚡', requirement: '7-day streak' },
  { id: 'streak_14', name: 'Unstoppable', description: '14-day streak', icon: '🚀', requirement: '14-day streak' },
  { id: 'streak_30', name: 'Monthly Master', description: '30-day streak', icon: '💎', requirement: '30-day streak' },

  // Points badges
  { id: 'points_100', name: 'Point Collector', description: 'Earn 100 points', icon: '🪙', requirement: 'Earn 100 total points' },
  { id: 'points_500', name: 'Point Hoarder', description: 'Earn 500 points', icon: '💰', requirement: 'Earn 500 total points' },
  { id: 'points_1000', name: 'Treasure Hunter', description: 'Earn 1,000 points', icon: '🏅', requirement: 'Earn 1000 total points' },

  // Level badges
  { id: 'level_5', name: 'Level 5!', description: 'Reach level 5', icon: '⭐', requirement: 'Reach level 5' },
  { id: 'level_10', name: 'Double Digits', description: 'Reach level 10', icon: '🌟', requirement: 'Reach level 10' },
  { id: 'level_20', name: 'Elite Status', description: 'Reach level 20', icon: '✨', requirement: 'Reach level 20' },

  // Special badges
  { id: 'early_bird', name: 'Early Bird', description: 'Complete a chore before 8 AM', icon: '🐦', requirement: 'Complete a chore before 8 AM' },
  { id: 'night_owl', name: 'Night Owl', description: 'Complete a chore after 9 PM', icon: '🦉', requirement: 'Complete a chore after 9 PM' },
  { id: 'speed_demon', name: 'Speed Demon', description: 'Complete a chore on the same day it was assigned', icon: '⚡', requirement: 'Same-day completion' },
  { id: 'team_player', name: 'Team Player', description: 'Be part of a family with 100+ completed chores', icon: '🤝', requirement: 'Family reaches 100 chores' },
  { id: 'perfectionist', name: 'Perfectionist', description: 'Have 10 chores verified in a row', icon: '💯', requirement: '10 verified chores in a row' },
]

export function getBadgeById(id: string): BadgeDefinition | undefined {
  return BADGES.find(b => b.id === id)
}
