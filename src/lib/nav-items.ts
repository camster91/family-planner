'use client'

import {
  Home,
  Calendar,
  CheckSquare,
  List,
  ListChecks,
  Users,
  UtensilsCrossed,
  StickyNote,
  Gift,
  Wallet,
  FolderKanban,
  Settings,
  BarChart3,
  MessageSquare,
  Cake,
  MapPin,
  Car,
  Sliders,
  Thermometer,
  Heart,
  UserPlus,
  Plane,
  Refrigerator,
  LayoutGrid,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { FEATURES, isFeatureEnabled, type FamilyFeatures, type FeatureKey } from '@/lib/features'
import { canRoleAccessPath, isKidRole } from '@/lib/kid-access'

/**
 * Navigation model (#269, docs/product/NAVIGATION.md).
 *
 * One home, five tabs: Today · Calendar · Meals · Lists · Family, in the phone
 * tab bar and the desktop top bar alike. Chores live on Today. Everything else
 * is under Family → More, listed only while its feature is on.
 *
 * Children get the tabs they can open (kid allowlist): Today (their kid home
 * at /dashboard) · Lists · Emergency. Teens also get Calendar and Meals
 * (O-37): Today · Calendar · Meals · Lists · Emergency. Family is parent-only,
 * so Emergency keeps its own tab for them: a child home alone must find it in
 * one tap.
 */

export interface TabItem {
  href: string
  label: string
  icon: LucideIcon
  /** Hidden while this feature is off. */
  featureKey?: FeatureKey
  /** Other routes that light this tab up (exact match, or a `/`-prefix). */
  alsoActiveOn?: readonly string[]
}

export const HOME_HREF = '/dashboard/today'
export const KID_HOME_HREF = '/dashboard'
export const MORE_HREF = '/dashboard/family/more'

export const PRIMARY_TABS: readonly TabItem[] = [
  { href: HOME_HREF, label: 'Today', icon: Home, alsoActiveOn: ['/dashboard', '/dashboard/chores'] },
  { href: '/dashboard/calendar', label: 'Calendar', icon: Calendar, featureKey: 'calendar' },
  { href: '/dashboard/meals', label: 'Meals', icon: UtensilsCrossed, featureKey: 'meals' },
  { href: '/dashboard/lists', label: 'Lists', icon: ListChecks, featureKey: 'lists' },
  // Family holds Emergency, More and every feature page reached from More.
  { href: '/dashboard/family', label: 'Family', icon: Users, featureKey: 'family' },
]

export const KID_TABS: readonly TabItem[] = [
  { href: KID_HOME_HREF, label: 'Today', icon: Home, alsoActiveOn: ['/dashboard/today'] },
  { href: '/dashboard/lists', label: 'Lists', icon: ListChecks, featureKey: 'lists' },
  { href: '/dashboard/emergency', label: 'Emergency', icon: Heart, featureKey: 'emergency' },
]

// Teens (O-37): the kid home, plus the family calendar and meals.
export const TEEN_TABS: readonly TabItem[] = [
  KID_TABS[0],
  { href: '/dashboard/calendar', label: 'Calendar', icon: Calendar, featureKey: 'calendar' },
  { href: '/dashboard/meals', label: 'Meals', icon: UtensilsCrossed, featureKey: 'meals' },
  KID_TABS[1],
  KID_TABS[2],
]

/** Where the logo and "home" go for this role. */
export function homeHrefFor(role: string | null | undefined): string {
  return isKidRole(role) ? KID_HOME_HREF : HOME_HREF
}

/** The tabs this role sees with these features: every tab it may open, feature-gated. */
export function tabsFor(role: string | null | undefined, features: FamilyFeatures): TabItem[] {
  const source = role === 'teen' ? TEEN_TABS : isKidRole(role) ? KID_TABS : PRIMARY_TABS
  return source.filter(
    (t) => canRoleAccessPath(role, t.href) && (!t.featureKey || isFeatureEnabled(features, t.featureKey))
  )
}

function matchesPath(pathname: string, route: string): boolean {
  if (route === '/dashboard') return pathname === '/dashboard' || pathname === '/dashboard/'
  return pathname === route || pathname.startsWith(route + '/')
}

/**
 * Whether `tab` is the current tab. Family also lights up on Emergency,
 * Features and every page listed under More, since that is where they live.
 */
export function isTabActive(tab: TabItem, pathname: string): boolean {
  if (matchesPath(pathname, tab.href)) return true
  if (tab.alsoActiveOn?.some((r) => matchesPath(pathname, r))) return true
  if (tab.href === '/dashboard/family') {
    return (
      matchesPath(pathname, '/dashboard/emergency') ||
      matchesPath(pathname, '/dashboard/features') ||
      MORE_FEATURE_KEYS.some((k) => {
        const meta = FEATURES.find((f) => f.key === k)
        return meta ? matchesPath(pathname, meta.href) : false
      })
    )
  }
  return false
}

// ─── More (Family → More) ────────────────────────────────────────────────

/**
 * Features listed under More, in this order, each only while it is on. The
 * five tab features are not here, and neither is Points & streaks (a setting;
 * its pages are Rewards and Analytics). Chores is listed first and always.
 */
export const MORE_FEATURE_KEYS: readonly FeatureKey[] = [
  'emergency',
  'inventory',
  'notes',
  'anniversaries',
  'messages',
  'projects',
  'budget',
  'rewards',
  'analytics',
  'wishlist',
  'pickups',
  'allowance',
  'handoff',
  'sick-days',
  'locations',
  'travel',
]

export interface MoreItem {
  key: FeatureKey
  title: string
  description: string
  href: string
  icon: LucideIcon
}

const MORE_ICONS: Partial<Record<FeatureKey, LucideIcon>> = {
  chores: CheckSquare,
  emergency: Heart,
  inventory: Refrigerator,
  notes: StickyNote,
  anniversaries: Cake,
  messages: MessageSquare,
  projects: FolderKanban,
  budget: Wallet,
  rewards: Gift,
  analytics: BarChart3,
  wishlist: Heart,
  pickups: Car,
  allowance: Wallet,
  handoff: UserPlus,
  'sick-days': Thermometer,
  locations: MapPin,
  travel: Plane,
}

function moreItem(key: FeatureKey): MoreItem {
  const meta = FEATURES.find((f) => f.key === key)!
  return { key, title: meta.title, description: meta.description, href: meta.href, icon: MORE_ICONS[key] ?? meta.icon }
}

/** Chores (always) plus every More feature that is on and that the role may open. */
export function moreItemsFor(role: string | null | undefined, features: FamilyFeatures): MoreItem[] {
  const keys: FeatureKey[] = ['chores', ...MORE_FEATURE_KEYS.filter((k) => isFeatureEnabled(features, k))]
  return keys.map(moreItem).filter((item) => canRoleAccessPath(role, item.href))
}

// ─── Command palette ─────────────────────────────────────────────────────

export interface NavItem {
  name: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  /** Feature key that gates this nav item. undefined = always visible (core). */
  featureKey?: FeatureKey
}

export const navItems: NavItem[] = [
  // Tabs
  { name: 'Today', href: HOME_HREF, icon: Home },
  { name: 'Calendar', href: '/dashboard/calendar', icon: Calendar, featureKey: 'calendar' },
  { name: 'Meals', href: '/dashboard/meals', icon: UtensilsCrossed, featureKey: 'meals' },
  { name: 'Lists', href: '/dashboard/lists', icon: List, featureKey: 'lists' },
  { name: 'Family', href: '/dashboard/family', icon: Users, featureKey: 'family' },
  { name: 'Chores', href: '/dashboard/chores', icon: CheckSquare, featureKey: 'chores' },
  { name: 'More', href: MORE_HREF, icon: LayoutGrid },

  // Under More — gated
  { name: 'Emergency', href: '/dashboard/emergency', icon: Heart, featureKey: 'emergency' },
  { name: 'Inventory', href: '/dashboard/inventory', icon: Refrigerator, featureKey: 'inventory' },
  { name: 'Notes', href: '/dashboard/notes', icon: StickyNote, featureKey: 'notes' },
  { name: 'Dates', href: '/dashboard/anniversaries', icon: Cake, featureKey: 'anniversaries' },
  { name: 'Rewards', href: '/dashboard/rewards', icon: Gift, featureKey: 'rewards' },
  { name: 'Budget', href: '/dashboard/budget', icon: Wallet, featureKey: 'budget' },
  { name: 'Projects', href: '/dashboard/projects', icon: FolderKanban, featureKey: 'projects' },
  { name: 'Messages', href: '/dashboard/messages', icon: MessageSquare, featureKey: 'messages' },
  { name: 'Analytics', href: '/dashboard/analytics', icon: BarChart3, featureKey: 'analytics' },
  { name: 'Locations', href: '/dashboard/locations', icon: MapPin, featureKey: 'locations' },
  { name: 'Pickups', href: '/dashboard/pickups', icon: Car, featureKey: 'pickups' },
  { name: 'Allowance', href: '/dashboard/allowance', icon: Wallet, featureKey: 'allowance' },
  { name: 'Handoff', href: '/dashboard/handoff', icon: UserPlus, featureKey: 'handoff' },
  { name: 'Sick days', href: '/dashboard/sick-days', icon: Thermometer, featureKey: 'sick-days' },
  { name: 'Wishlist', href: '/dashboard/wishlist', icon: Heart, featureKey: 'wishlist' },
  { name: 'Travel', href: '/dashboard/travel', icon: Plane, featureKey: 'travel' },

  // Settings
  { name: 'Features', href: '/dashboard/features', icon: Sliders },
  { name: 'Settings', href: '/dashboard/settings', icon: Settings },
]

export const searchPlaceholder = 'Search across chores, events, lists, and people'
