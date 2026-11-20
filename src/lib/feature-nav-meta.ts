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
    description: 'Family members, and how to invite more people.',
    href: '/dashboard/family',
  },
  chores: {
    title: 'Chores',
    description: 'Assign chores and see what is done.',
    href: '/dashboard/chores',
  },
  emergency: {
    title: 'Emergency contacts',
    description: 'A card with medical and emergency info for each person.',
    href: '/dashboard/emergency',
  },
  inventory: {
    title: 'Food inventory',
    description: 'Track what is in the fridge, freezer and pantry, and what to use soon.',
    href: '/dashboard/inventory',
  },
  notes: {
    title: 'Pinned notes',
    description: 'Short notes everyone can see, like a fridge note.',
    href: '/dashboard/notes',
  },
  anniversaries: {
    title: 'Birthdays & anniversaries',
    description: 'Reminders for upcoming family dates.',
    href: '/dashboard/anniversaries',
  },
  messages: {
    title: 'Family chat',
    description: 'Send messages to your family in the app.',
    href: '/dashboard/messages',
  },
  projects: {
    title: 'Projects',
    description: 'Plan trips, home jobs and big family goals.',
    href: '/dashboard/projects',
  },
  budget: {
    title: 'Budget',
    description: 'Track family spending and set budgets.',
    href: '/dashboard/budget',
  },
  rewards: {
    title: 'Rewards',
    description: 'Kids trade chore points for rewards you pick.',
    href: '/dashboard/rewards',
  },
  analytics: {
    title: 'Analytics',
    description: 'See streaks and how the week went.',
    href: '/dashboard/analytics',
  },
  wishlist: {
    title: 'Wishlist',
    description: 'Kids add things they want. Parents keep track.',
    href: '/dashboard/wishlist',
  },
  pickups: {
    title: 'Pickups & dropoffs',
    description: 'Plan who picks up the kids, and when.',
    href: '/dashboard/pickups',
  },
  allowance: {
    title: 'Allowance & IOUs',
    description: 'Track allowance and money people owe each other.',
    href: '/dashboard/allowance',
  },
  handoff: {
    title: 'Babysitter handoff',
    description: 'One page for a sitter that you can print or share.',
    href: '/dashboard/handoff',
  },
  'sick-days': {
    title: 'Sick days & meds',
    description: 'Track who is sick, their temperature and when meds are due.',
    href: '/dashboard/sick-days',
  },
  locations: {
    title: 'Locations',
    description: 'Save home, school and work addresses.',
    href: '/dashboard/locations',
  },
  travel: {
    title: 'Travel mode',
    description: 'Quiet non-urgent tasks and move chores while you are away.',
    href: '/dashboard/travel',
  },
}

export function featureNavMeta(key: FeatureKey): FeatureNavMeta | undefined {
  return (FEATURE_NAV_META as Partial<Record<FeatureKey, FeatureNavMeta>>)[key]
}
