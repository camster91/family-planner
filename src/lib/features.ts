// Per-family feature flags. Parents toggle these in Family settings.
// New households start simple (O-38, owner decision 2026-10-03): only Chores,
// Calendar, Lists, Family, Meal planning and Emergency contacts are on. Every
// other section is off for a NEW household and a parent turns it on (the
// Features page, or the "Turn on more" card on the Today board).
// Households that existed before a default changed keep what they had: a
// stored blob without a key reads as that key's `legacyDefault`. That covers
// Points & streaks (`gamification`, #248) and the sections that were on by
// default until O-38 (notes, anniversaries, rewards, budget, projects,
// messages, analytics). New households never rely on it: POST /api/family
// stores the full `defaultFeatures()` blob, and so does the column default.

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
  Thermometer,
  Sparkles,
  Refrigerator,
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
  | 'sick-days'
  | 'gamification'
  | 'inventory'

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
  /**
   * Value assumed when a STORED feature blob lacks this key (an existing
   * household whose blob predates the key or the default change). Omitted =
   * same as `defaultEnabled`. For `gamification` scripts/migrate.js also writes
   * it explicitly; for the O-38 keys this read-time fallback is the mechanism
   * (no data is rewritten).
   */
  legacyDefault?: boolean
  /** Another feature this one depends on. Off whenever that one is off. */
  requires?: FeatureKey
}

/** Single source of truth for every toggleable feature in the app. */
export const FEATURES: FeatureMeta[] = [
  // Core — on by default (Emergency contacts, below, is core too)
  { key: 'chores', title: 'Chores', description: 'Assign chores and see what is done.', group: 'core', icon: CheckSquare, glyphColor: 'chore', href: '/dashboard/chores', defaultEnabled: true },
  { key: 'calendar', title: 'Calendar', description: 'Shared family calendar with events and tasks.', group: 'core', icon: Calendar, glyphColor: 'calendar', href: '/dashboard/calendar', defaultEnabled: true },
  { key: 'lists', title: 'Lists', description: 'Shopping lists, to-dos, and packing lists everyone can edit.', group: 'core', icon: ListChecks, glyphColor: 'lists', href: '/dashboard/lists', defaultEnabled: true },
  { key: 'family', title: 'Family', description: 'Members, roles, invite codes, and family settings.', group: 'core', icon: Users, glyphColor: 'family', href: '/dashboard/family', defaultEnabled: true },

  // Planning — Meal planning is on for a new household; the rest are opt-in
  // since O-38 but stay on for existing households (`legacyDefault`).
  { key: 'meals', title: 'Meal planning', description: 'Plan breakfast, lunch, and dinner for the week.', group: 'planning', icon: UtensilsCrossed, glyphColor: 'meals', href: '/dashboard/meals', defaultEnabled: true },
  // Food inventory (#263): what is in the fridge, freezer and pantry, what to
  // use soon, and which saved recipes it covers. Opt-in for new and existing
  // households alike (it needs data entry to be useful and adds a nav entry),
  // so a stored blob without the key reads as off and scripts/migrate.js
  // stamps nothing. "What can I cook" also needs Meal planning (recipes).
  { key: 'inventory', title: 'Food inventory', description: 'Track what is in the fridge, freezer and pantry, and what to use soon.', group: 'planning', icon: Refrigerator, glyphColor: 'meals', href: '/dashboard/inventory', defaultEnabled: false },
  { key: 'notes', title: 'Pinned notes', description: 'Sticky notes for the fridge, school pickup, weekend plans.', group: 'planning', icon: StickyNote, glyphColor: 'lists', href: '/dashboard/notes', defaultEnabled: false, legacyDefault: true },
  { key: 'anniversaries', title: 'Birthdays & anniversaries', description: 'Reminders for upcoming family dates.', group: 'planning', icon: Cake, glyphColor: 'family', href: '/dashboard/anniversaries', defaultEnabled: false, legacyDefault: true },
  // Points, XP, levels, streaks and the leaderboard (#248). Calm by default:
  // new households start with it off; households that existed before the flag
  // keep it on. XP keeps accruing in the background either way, so switching
  // it back on shows up-to-date totals.
  { key: 'gamification', title: 'Points & streaks', description: 'XP, levels, streaks, and the family leaderboard for chores.', group: 'planning', icon: Sparkles, glyphColor: 'rewards', href: '/dashboard/analytics', defaultEnabled: false, legacyDefault: true },
  { key: 'rewards', title: 'Rewards', description: 'Kids spend XP on rewards you set.', group: 'planning', icon: Gift, glyphColor: 'rewards', href: '/dashboard/rewards', defaultEnabled: false, legacyDefault: true, requires: 'gamification' },
  { key: 'budget', title: 'Budget', description: 'Track shared expenses and category budgets.', group: 'planning', icon: Wallet, glyphColor: 'budget', href: '/dashboard/budget', defaultEnabled: false, legacyDefault: true },
  { key: 'projects', title: 'Projects', description: 'Plan trips, renovations, and big family goals.', group: 'planning', icon: FolderKanban, glyphColor: 'projects', href: '/dashboard/projects', defaultEnabled: false, legacyDefault: true },
  { key: 'messages', title: 'Family chat', description: 'Built-in messaging so you do not need a separate app.', group: 'planning', icon: MessageSquare, glyphColor: 'messages', href: '/dashboard/messages', defaultEnabled: false, legacyDefault: true },
  { key: 'analytics', title: 'Analytics', description: 'Streaks, leaderboard, and weekly family trends.', group: 'planning', icon: TrendingUp, glyphColor: 'chore', href: '/dashboard/analytics', defaultEnabled: false, legacyDefault: true, requires: 'gamification' },
  { key: 'wishlist', title: 'Wishlist', description: 'What the family wants. Kids add, parents track.', group: 'planning', icon: Heart, glyphColor: 'rewards', href: '/dashboard/wishlist', defaultEnabled: false },
  { key: 'emergency', title: 'Emergency contacts', description: 'Printable medical + emergency info card for each family member.', group: 'core', icon: Heart, glyphColor: 'family', href: '/dashboard/emergency', defaultEnabled: true },

  // Family — opt-in, parents turn these on deliberately
  { key: 'locations', title: 'Locations', description: 'Save home, school, and work addresses for the family.', group: 'family', icon: MapPin, glyphColor: 'calendar', href: '/dashboard/locations', defaultEnabled: false },
  { key: 'pickups', title: 'Pickups & dropoffs', description: 'Coordinate who is picking up the kids and when.', group: 'family', icon: Car, glyphColor: 'lists', href: '/dashboard/pickups', defaultEnabled: false },
  { key: 'allowance', title: 'Allowance & IOUs', description: 'Track weekly allowance and money owed between members.', group: 'family', icon: Wallet, glyphColor: 'budget', href: '/dashboard/allowance', defaultEnabled: false },
  { key: 'travel', title: 'Travel mode', description: 'Mute non-urgent tasks and shift chore schedule while away.', group: 'family', icon: Plane, glyphColor: 'calendar', href: '/dashboard/travel', defaultEnabled: false },
  { key: 'handoff', title: 'Babysitter handoff', description: 'One-screen sitter brief with printable + shareable link.', group: 'family', icon: UserPlus, glyphColor: 'family', href: '/dashboard/handoff', defaultEnabled: false },
  { key: 'sick-days', title: 'Sick days & meds', description: 'Track active illness, temperature, and medication schedule.', group: 'family', icon: Thermometer, glyphColor: 'family', href: '/dashboard/sick-days', defaultEnabled: false },
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
 * Normalize a feature blob from the DB. A key missing from a stored blob falls
 * back to its `legacyDefault` (else `defaultEnabled`) — this way families that
 * existed before a feature shipped or a default changed keep their behavior,
 * including an empty `{}` or partial blob — and unknown keys are dropped. No
 * stored blob at all (null / not an object) means "use the brand-new family
 * defaults"; scripts/migrate.js turns a stored NULL into an object (#248), so
 * an existing household never reads as NULL.
 */
export function normalizeFeatures(raw: unknown): FamilyFeatures {
  const def = defaultFeatures()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return def
  const obj = raw as Record<string, unknown>
  for (const f of FEATURES) {
    if (typeof obj[f.key] === 'boolean') {
      def[f.key] = obj[f.key] as boolean
    } else if (f.legacyDefault !== undefined) {
      def[f.key] = f.legacyDefault
    }
  }
  return def
}

/**
 * Whether a feature is effectively on: its own flag AND the feature it
 * requires. Rewards and Analytics need Points & streaks (#248). Use this, not
 * `features[key]`, for every gate (routes, pages, nav); the raw flag is only
 * for the Features settings toggles.
 */
export function isFeatureEnabled(features: FamilyFeatures, key: FeatureKey): boolean {
  if (features[key] !== true) return false
  const meta = FEATURES.find((f) => f.key === key)
  return meta?.requires ? isFeatureEnabled(features, meta.requires) : true
}

/** The raw flags with every feature whose requirement is off forced off. */
export function effectiveFeatures(features: FamilyFeatures): FamilyFeatures {
  const out = { ...features }
  for (const f of FEATURES) out[f.key] = isFeatureEnabled(features, f.key)
  return out
}

/** Group features for the settings UI. */
export function groupFeatures(features: FeatureMeta[]) {
  return {
    core: features.filter((f) => f.group === 'core'),
    planning: features.filter((f) => f.group === 'planning'),
    family: features.filter((f) => f.group === 'family'),
  }
}
