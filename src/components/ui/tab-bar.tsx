'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Home, Calendar, ListChecks, Users, LucideIcon } from 'lucide-react'
import { User } from '@/types'

/**
 * TabBar — iOS-style bottom tab bar.
 * The home surface for the app: 4 destinations, more inside Family.
 */
type TabItem = {
  href: string
  label: string
  icon: LucideIcon
  matchPrefix?: boolean
}

const TABS: TabItem[] = [
  { href: '/dashboard', label: 'Today', icon: Home },
  { href: '/dashboard/calendar', label: 'Calendar', icon: Calendar, matchPrefix: true },
  { href: '/dashboard/lists', label: 'Lists', icon: ListChecks, matchPrefix: true },
  { href: '/dashboard/family', label: 'Family', icon: Users, matchPrefix: true },
]

export function TabBar({ user }: { user: User | null }) {
  const pathname = usePathname()

  return (
    <nav className="tab-bar md:hidden">
      <ul className="flex items-stretch justify-around px-2 pt-1.5 pb-1.5">
        {TABS.map((tab) => {
          const isActive = tab.matchPrefix
            ? pathname.startsWith(tab.href)
            : pathname === tab.href
          const Icon = tab.icon
          return (
            <li key={tab.href} className="flex-1">
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
                    'w-[26px] h-[26px] transition-transform duration-200',
                    isActive && 'scale-105'
                  )}
                  strokeWidth={isActive ? 2.4 : 1.8}
                />
                <span className={cn(
                  'text-[10px] leading-tight',
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
