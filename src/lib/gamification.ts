// Gamification utilities — stubbed out (rewards/points system removed)
// This file exists to satisfy imports from ActivityFeed and ChoreList

export interface Badge {
  id: string
  name: string
  description: string
  icon: string
  criteria: string
}

const badges: Badge[] = [
  { id: 'first_chore', name: 'First Step', description: 'Complete your first chore', icon: '🌟', criteria: 'complete_1_chore' },
  { id: 'streak_3', name: 'On Fire', description: '3-day streak', icon: '🔥', criteria: '3_day_streak' },
  { id: 'streak_7', name: 'Week Warrior', description: '7-day streak', icon: '💪', criteria: '7_day_streak' },
  { id: 'points_50', name: 'Point Collector', description: 'Earn 50 points', icon: '💎', criteria: 'earn_50_points' },
]

export function getBadgeById(id: string): Badge | undefined {
  return badges.find(b => b.id === id)
}