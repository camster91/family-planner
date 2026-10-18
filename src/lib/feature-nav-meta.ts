import type { FeatureKey } from './features'

type MoreFeatureKey =
  | 'family'
  | 'chores'
  | 'emergency'
  | 'inventory'
  | 'notes'
  | 'anniversaries'
  | 'messages'
  | 'projects'
  | 'budget'
  | 'rewards'
  | 'analytics'
  | 'wishlist'
  | 'pickups'
  | 'allowance'
  | 'handoff'
  | 'sick-days'
  | 'locations'
  | 'travel'

export type FeatureNavMeta = {
  title: string
  description: string
  href: string
}

/** Navigation-only metadata; full feature settings metadata stays route-local. */
export const FEATURE_NAV_META: Record<MoreFeatureKey, FeatureNavMeta> = {
  family: {
    title: 'Family',
    description: 'Members, roles, invite codes, and family settings.',
    href: '/dashboard/family',
  },
  chores: {
    title: 'Chores',
    description: 'Assign chores and see what is done.',
    href: '/dashboard/chores',
  },
  emergency: {
    title: 'Emergency contacts',
    description: 'Printable medical + emergency info card for each family member.',
    href: '/dashboard/emergency',
  },
  inventory: {
    title: 'Food inventory',
    description: 'Track what is in the fridge, freezer and pantry, and what to use soon.',
    href: '/dashboard/inventory',
  },
  notes: {
    title: 'Pinned notes',
    description: 'Sticky notes for the fridge, school pickup, weekend plans.',
    href: '/dashboard/notes',
  },
  anniversaries: {
    title: 'Birthdays & anniversaries',
    description: 'Reminders for upcoming family dates.',
    href: '/dashboard/anniversaries',
  },
  messages: {
    title: 'Family chat',
    description: 'Built-in messaging so you do not need a separate app.',
    href: '/dashboard/messages',
  },
  projects: {
    title: 'Projects',
    description: 'Plan trips, renovations, and big family goals.',
    href: '/dashboard/projects',
  },
  budget: {
    title: 'Budget',
    description: 'Track shared expenses and category budgets.',
    href: '/dashboard/budget',
  },
  rewards: {
    title: 'Rewards',
    description: 'Kids spend their chore points on rewards you set.',
    href: '/dashboard/rewards',
  },
  analytics: {
    title: 'Analytics',
    description: 'Streaks, leaderboard, and weekly family trends.',
    href: '/dashboard/analytics',
  },
  wishlist: {
    title: 'Wishlist',
    description: 'What the family wants. Kids add, parents track.',
    href: '/dashboard/wishlist',
  },
  pickups: {
    title: 'Pickups & dropoffs',
    description: 'Coordinate who is picking up the kids and when.',
    href: '/dashboard/pickups',
  },
  allowance: {
    title: 'Allowance & IOUs',
    description: 'Track weekly allowance and money owed between members.',
    href: '/dashboard/allowance',
  },
  handoff: {
    title: 'Babysitter handoff',
    description: 'One-screen sitter brief with printable + shareable link.',
    href: '/dashboard/handoff',
  },
  'sick-days': {
    title: 'Sick days & meds',
    description: 'Track active illness, temperature, and medication schedule.',
    href: '/dashboard/sick-days',
  },
  locations: {
    title: 'Locations',
    description: 'Save home, school, and work addresses for the family.',
    href: '/dashboard/locations',
  },
  travel: {
    title: 'Travel mode',
    description: 'Mute non-urgent tasks and shift chore schedule while away.',
    href: '/dashboard/travel',
  },
}

export function featureNavMeta(key: FeatureKey): FeatureNavMeta | undefined {
  return (FEATURE_NAV_META as Partial<Record<FeatureKey, FeatureNavMeta>>)[key]
}
