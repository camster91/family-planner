'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Calendar, Home, LayoutGrid, LucideIcon, Sparkles, Users } from 'lucide-react'
import { User } from '@/types'

/**
 * TabBar — iOS-style bottom tab bar for the Life Hub shell.
 * Mini-app-specific destinations live in Apps rather than competing for
 * permanent tab-bar space.
 */
type TabItem = {
  href: string
  label: string
  icon: LucideIcon
  matchPrefix?: boolean
}

const TABS: TabItem[] = [
  { href: '/dashboard', label: 'Today', icon: Home },
  { href: '/dashboard/life-chat', label: 'Chat', icon: Sparkles, matchPrefix: true },
  { href: '/dashboard/apps', label: 'Apps', icon: LayoutGrid, matchPrefix: true },
  { href: '/dashboard/calendar', label: 'Calendar', icon: Calendar, matchPrefix: true },
  { href: '/dashboard/family', label: 'Family', icon: Users, matchPrefix: true },
]

export function TabBar({ user }: { user: User | null }) {
  const pathname = usePathname()

  return (
    <nav className="tab-bar md:hidden" aria-label="Life Hub navigation">
      <ul className="flex items-stretch justify-around px-1 pt-1.5 pb-1.5">
        {TABS.map((tab) => {
          const isActive = tab.matchPrefix
            ? pathname.startsWith(tab.href)
            : pathname === tab.href
          const Icon = tab.icon
          return (
            <li key={tab.href} className="flex-1 min-w-0">
              <Link
                href={tab.href}
                className={cn(
                  'flex flex-col items-center gap-0.5 py-1.5 rounded-md transition-colors duration-200',
                  isActive
                    ? 'text-accent'
                    : 'text-label-tertiary active:text-label-secondary'
                )}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon
                  className={cn(
                    'w-[24px] h-[24px] transition-transform duration-200',
                    isActive && 'scale-105'
                  )}
                  strokeWidth={isActive ? 2.4 : 1.8}
                />
                <span className={cn(
                  'text-[10px] leading-tight truncate max-w-full px-0.5',
                  isActive ? 'font-semibold' : 'font-medium'
                )}>
                  {tab.label}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
