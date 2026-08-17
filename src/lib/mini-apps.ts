import type { LucideIcon } from 'lucide-react'
import {
  BarChart3,
  Calendar,
  CheckSquare,
  FolderKanban,
  Gift,
  Heart,
  ListChecks,
  MessageSquare,
  Repeat2,
  Sparkles,
  Users,
  UtensilsCrossed,
  Wallet,
} from 'lucide-react'

export type MiniAppStatus = 'active' | 'foundation' | 'planned'

export interface MiniAppDefinition {
  key: string
  title: string
  description: string
  href: string | null
  icon: LucideIcon
  status: MiniAppStatus
  source: 'family-planner' | 'meal-planner' | 'chore-champs' | 'lifestreak' | 'life-hub'
}

/**
 * Product-level registry for the Life Hub.
 *
 * Existing feature flags still control whether a family's current modules are
 * visible. This registry describes the consolidated product surface and lets
 * the Apps hub/Life Chat reason about where each domain lives while migration
 * work is still in progress.
 */
export const MINI_APPS: MiniAppDefinition[] = [
  {
    key: 'life-chat',
    title: 'Life Chat',
    description: 'Conversational access to your life apps. Starts read-only and gains confirmed actions later.',
    href: '/dashboard/life-chat',
    icon: Sparkles,
    status: 'foundation',
    source: 'life-hub',
  },
  {
    key: 'chores',
    title: 'Chores',
    description: 'Assign chores, approve completions, earn points, badges and rewards.',
    href: '/dashboard/chores',
    icon: CheckSquare,
    status: 'active',
    source: 'chore-champs',
  },
  {
    key: 'habits',
    title: 'Habits',
    description: 'General-purpose routines, schedules, progress, streaks and weekly review.',
    href: null,
    icon: Repeat2,
    status: 'planned',
    source: 'lifestreak',
  },
  {
    key: 'meals',
    title: 'Meals',
    description: 'Weekly meals today, with recipes, ingredients, reusable plans and smart grocery lists coming next.',
    href: '/dashboard/meals',
    icon: UtensilsCrossed,
    status: 'active',
    source: 'meal-planner',
  },
  {
    key: 'calendar',
    title: 'Calendar',
    description: 'Shared family events, appointments, tasks and schedules.',
    href: '/dashboard/calendar',
    icon: Calendar,
    status: 'active',
    source: 'family-planner',
  },
  {
    key: 'lists',
    title: 'Lists',
    description: 'Shared shopping, grocery, packing and to-do lists.',
    href: '/dashboard/lists',
    icon: ListChecks,
    status: 'active',
    source: 'family-planner',
  },
  {
    key: 'rewards',
    title: 'Rewards',
    description: 'Parent-defined rewards and kid-friendly redemption flows.',
    href: '/dashboard/rewards',
    icon: Gift,
    status: 'active',
    source: 'chore-champs',
  },
  {
    key: 'budget',
    title: 'Budget',
    description: 'Shared spending, income, categories and household budgets.',
    href: '/dashboard/budget',
    icon: Wallet,
    status: 'active',
    source: 'family-planner',
  },
  {
    key: 'projects',
    title: 'Projects',
    description: 'Family goals, trips, renovations and multi-step plans.',
    href: '/dashboard/projects',
    icon: FolderKanban,
    status: 'active',
    source: 'family-planner',
  },
  {
    key: 'messages',
    title: 'Messages',
    description: 'Family messaging and announcements.',
    href: '/dashboard/messages',
    icon: MessageSquare,
    status: 'active',
    source: 'family-planner',
  },
  {
    key: 'family',
    title: 'Family',
    description: 'Members, roles, profiles and family settings.',
    href: '/dashboard/family',
    icon: Users,
    status: 'active',
    source: 'family-planner',
  },
  {
    key: 'emergency',
    title: 'Emergency',
    description: 'Emergency contacts and practical family information.',
    href: '/dashboard/emergency',
    icon: Heart,
    status: 'active',
    source: 'family-planner',
  },
  {
    key: 'analytics',
    title: 'Insights',
    description: 'Family activity and, later, schedule-aware habit insights.',
    href: '/dashboard/analytics',
    icon: BarChart3,
    status: 'active',
    source: 'family-planner',
  },
]

export function findMiniAppByQuery(query: string): MiniAppDefinition | null {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return null

  const aliases: Record<string, string[]> = {
    'life-chat': ['life chat', 'assistant', 'chat'],
    chores: ['chore', 'chores', 'tasks for kids'],
    habits: ['habit', 'habits', 'routines', 'streaks'],
    meals: ['meal', 'meals', 'recipe', 'recipes', 'dinner', 'food'],
    calendar: ['calendar', 'schedule', 'events', 'appointments'],
    lists: ['list', 'lists', 'grocery', 'shopping', 'packing'],
    rewards: ['reward', 'rewards', 'points', 'badges'],
    budget: ['budget', 'money', 'spending', 'expenses'],
    projects: ['project', 'projects', 'goals'],
    messages: ['message', 'messages', 'family chat'],
    family: ['family', 'people', 'members'],
    emergency: ['emergency', 'contacts'],
    analytics: ['analytics', 'insights', 'stats', 'progress'],
  }

  for (const app of MINI_APPS) {
    const terms = [app.title.toLowerCase(), app.key, ...(aliases[app.key] ?? [])]
    if (terms.some((term) => normalized.includes(term))) return app
  }

  return null
}
