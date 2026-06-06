'use client'

import {
  Home,
  Calendar,
  CheckSquare,
  List,
  Users,
  UtensilsCrossed,
  StickyNote,
  Gift,
  Wallet,
  FolderKanban,
  Settings,
  BarChart3,
  MessageSquare,
  Search,
  Cake,
  MapPin,
  Car,
  Sliders,
} from 'lucide-react'

export interface NavItem {
  name: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  /** Feature key that gates this nav item. undefined = always visible (core). */
  featureKey?: string
}

export const navItems: NavItem[] = [
  // Core — always visible
  { name: 'Today', href: '/dashboard', icon: Home },
  { name: 'Calendar', href: '/dashboard/calendar', icon: Calendar, featureKey: 'calendar' },
  { name: 'Chores', href: '/dashboard/chores', icon: CheckSquare, featureKey: 'chores' },
  { name: 'Lists', href: '/dashboard/lists', icon: List, featureKey: 'lists' },
  { name: 'Family', href: '/dashboard/family', icon: Users, featureKey: 'family' },

  // Planning — gated
  { name: 'Meals', href: '/dashboard/meals', icon: UtensilsCrossed, featureKey: 'meals' },
  { name: 'Notes', href: '/dashboard/notes', icon: StickyNote, featureKey: 'notes' },
  { name: 'Dates', href: '/dashboard/anniversaries', icon: Cake, featureKey: 'anniversaries' },
  { name: 'Rewards', href: '/dashboard/rewards', icon: Gift, featureKey: 'rewards' },
  { name: 'Budget', href: '/dashboard/budget', icon: Wallet, featureKey: 'budget' },
  { name: 'Projects', href: '/dashboard/projects', icon: FolderKanban, featureKey: 'projects' },
  { name: 'Messages', href: '/dashboard/messages', icon: MessageSquare, featureKey: 'messages' },
  { name: 'Analytics', href: '/dashboard/analytics', icon: BarChart3, featureKey: 'analytics' },

  // Family — gated, default off
  { name: 'Locations', href: '/dashboard/locations', icon: MapPin, featureKey: 'locations' },
  { name: 'Pickups', href: '/dashboard/pickups', icon: Car, featureKey: 'pickups' },
  { name: 'Allowance', href: '/dashboard/allowance', icon: Wallet, featureKey: 'allowance' },

  // Settings
  { name: 'Features', href: '/dashboard/features', icon: Sliders },
  { name: 'Settings', href: '/dashboard/settings', icon: Settings },
]

export const recentItems = [
  { id: '1', name: 'Weekly chores', type: 'chore' },
  { id: '2', name: 'Family dinner', type: 'event' },
  { id: '3', name: 'Grocery list', type: 'list' },
]

export const searchPlaceholder = 'Search across chores, events, lists, and people'
