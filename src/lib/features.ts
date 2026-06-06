// Per-family feature flags. Parents toggle these in Family settings.
// Each feature is opt-out: defaults are picked so a brand-new family gets
// the core experience without having to turn things on.

import type { LucideIcon } from 'lucide-react'
import {
  UtensilsCrossed,
  StickyNote,
  Cake,
  MapPin,
  Car,
  Wallet,
  Gift,
  TrendingUp,
  MessageSquare,
  FolderKanban,
  CheckSquare,
  Calendar,
  ListChecks,
  Users,
  Heart,
  Plane,
  UserPlus,
} from 'lucide-react'

export type FeatureKey =
  // Core (always on, cannot be disabled)
  | 'chores'
  | 'calendar'
  | 'lists'
  | 'family'
  // Toggleable
  | 'meals'
  | 'notes'
  | 'anniversaries'
  | 'locations'
  | 'pickups'
  | 'allowance'
  | 'rewards'
  | 'budget'
  | 'projects'
  | 'messages'
  | 'analytics'
  | 'wishlist'
  | 'travel'
  | 'emergency'
  | 'handoff'

export interface FeatureMeta {
  key: FeatureKey
  /** Human title shown in the toggle list and the command palette */
  title: string
  /** One-line description of what the feature does */
  description: string
  /** Grouping for the settings UI (Core, Planning, Family) */
  group: 'core' | 'planning' | 'family'
  /** Lucide icon for the settings row + nav */
  icon: LucideIcon
  /** Glyph color from the design system (chore | calendar | lists | ...) */
  glyphColor: 'meals' | 'lists' | 'family' | 'budget' | 'rewards' | 'projects' | 'messages' | 'calendar' | 'chore'
  /** Where the feature lives in the app — used to gate the nav item + route */
  href: string
  /** Whether a fresh family gets this on by default */
  defaultEnabled: boolean
}

/** Single source of truth for every toggleable feature in the app. */
export const FEATURES: FeatureMeta[] = [
  // Core — on by default
  { key: 'chores', title: 'Chores', description: 'Assign chores, track points, and let kids earn rewards.', group: 'core', icon: CheckSquare, glyphColor: 'chore', href: '/dashboard/chores', defaultEnabled: true },
  { key: 'calendar', title: 'Calendar', description: 'Shared family calendar with events and tasks.', group: 'core', icon: Calendar, glyphColor: 'calendar', href: '/dashboard/calendar', defaultEnabled: true },
  { key: 'lists', title: 'Lists', description: 'Shopping lists, to-dos, and packing lists everyone can edit.', group: 'core', icon: ListChecks, glyphColor: 'lists', href: '/dashboard/lists', defaultEnabled: true },
  { key: 'family', title: 'Family', description: 'Members, roles, invite codes, and family settings.', group: 'core', icon: Users, glyphColor: 'family', href: '/dashboard/family', defaultEnabled: true },

  // Planning — on by default, easy to turn off
  { key: 'meals', title: 'Meal planning', description: 'Plan breakfast, lunch, and dinner for the week.', group: 'planning', icon: UtensilsCrossed, glyphColor: 'meals', href: '/dashboard/meals', defaultEnabled: true },
  { key: 'notes', title: 'Pinned notes', description: 'Sticky notes for the fridge, school pickup, weekend plans.', group: 'planning', icon: StickyNote, glyphColor: 'lists', href: '/dashboard/notes', defaultEnabled: true },
  { key: 'anniversaries', title: 'Birthdays & anniversaries', description: 'Reminders for upcoming family dates.', group: 'planning', icon: Cake, glyphColor: 'family', href: '/dashboard/anniversaries', defaultEnabled: true },
  { key: 'rewards', title: 'Rewards', description: 'Kids spend XP on rewards you set.', group: 'planning', icon: Gift, glyphColor: 'rewards', href: '/dashboard/rewards', defaultEnabled: true },
  { key: 'budget', title: 'Budget', description: 'Track shared expenses and category budgets.', group: 'planning', icon: Wallet, glyphColor: 'budget', href: '/dashboard/budget', defaultEnabled: true },
  { key: 'projects', title: 'Projects', description: 'Plan trips, renovations, and big family goals.', group: 'planning', icon: FolderKanban, glyphColor: 'projects', href: '/dashboard/projects', defaultEnabled: true },
  { key: 'messages', title: 'Family chat', description: 'Built-in messaging so you do not need a separate app.', group: 'planning', icon: MessageSquare, glyphColor: 'messages', href: '/dashboard/messages', defaultEnabled: true },
  { key: 'analytics', title: 'Analytics', description: 'Streaks, leaderboard, and weekly family trends.', group: 'planning', icon: TrendingUp, glyphColor: 'chore', href: '/dashboard/analytics', defaultEnabled: true },
  { key: 'wishlist', title: 'Wishlist', description: 'What the family wants. Kids add, parents track.', group: 'planning', icon: Heart, glyphColor: 'rewards', href: '/dashboard/wishlist', defaultEnabled: false },
  { key: 'emergency', title: 'Emergency contacts', description: 'Printable medical + emergency info card for each family member.', group: 'core', icon: Heart, glyphColor: 'family', href: '/dashboard/emergency', defaultEnabled: true },

  // Family — opt-in, parents turn these on deliberately
  { key: 'locations', title: 'Locations', description: 'Save home, school, and work addresses for the family.', group: 'family', icon: MapPin, glyphColor: 'calendar', href: '/dashboard/locations', defaultEnabled: false },
  { key: 'pickups', title: 'Pickups & dropoffs', description: 'Coordinate who is picking up the kids and when.', group: 'family', icon: Car, glyphColor: 'lists', href: '/dashboard/pickups', defaultEnabled: false },
  { key: 'allowance', title: 'Allowance & IOUs', description: 'Track weekly allowance and money owed between members.', group: 'family', icon: Wallet, glyphColor: 'budget', href: '/dashboard/allowance', defaultEnabled: false },
  { key: 'travel', title: 'Travel mode', description: 'Mute non-urgent tasks and shift chore schedule while away.', group: 'family', icon: Plane, glyphColor: 'calendar', href: '/dashboard/travel', defaultEnabled: false },
  { key: 'handoff', title: 'Babysitter handoff', description: 'One-screen sitter brief with printable + shareable link.', group: 'family', icon: UserPlus, glyphColor: 'family', href: '/dashboard/handoff', defaultEnabled: false },
]

/** The shape stored on Family.features as a JSON column. */
export type FamilyFeatures = Record<FeatureKey, boolean>

/** The default flag set for a brand-new family. */
export function defaultFeatures(): FamilyFeatures {
  const out = {} as FamilyFeatures
  for (const f of FEATURES) {
    out[f.key] = f.defaultEnabled
  }
  return out
}

/**
 * Normalize a feature blob from the DB. Anything missing falls back to the
 * default — this way families that joined before a new feature shipped still
 * get sensible behavior, and unknown keys are dropped.
 */
export function normalizeFeatures(raw: unknown): FamilyFeatures {
  const def = defaultFeatures()
  if (!raw || typeof raw !== 'object') return def
  const obj = raw as Record<string, unknown>
  for (const f of FEATURES) {
    if (typeof obj[f.key] === 'boolean') {
      def[f.key] = obj[f.key] as boolean
    }
  }
  return def
}

export function isFeatureEnabled(features: FamilyFeatures, key: FeatureKey): boolean {
  return features[key] === true
}

/** Group features for the settings UI. */
export function groupFeatures(features: FeatureMeta[]) {
  return {
    core: features.filter((f) => f.group === 'core'),
    planning: features.filter((f) => f.group === 'planning'),
    family: features.filter((f) => f.group === 'family'),
  }
}
