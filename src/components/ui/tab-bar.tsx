'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import type { NavUser } from '@/types'
import { isTabActive, tabsFor } from '@/lib/nav-items'
import { useFeatures } from '@/components/providers/features-provider'

/**
 * TabBar — bottom tab bar on phones (below `md`).
 * Parents: Today · Calendar · Meals · Lists · Family (#269). Children and teens:
 * the tabs they may open (src/lib/nav-items.ts). Feature-gated tabs hide while
 * their feature is off. The top bar carries the same tabs from `md` up.
 */
export function TabBar({ user }: { user: NavUser | null }) {
  const pathname = usePathname()
  const { features } = useFeatures()
  const tabs = tabsFor(user?.role, features)

  return (
    <nav className="tab-bar md:hidden" aria-label="Tabs">
      <ul className="flex items-stretch justify-around px-2 pt-1.5 pb-1.5">
        {tabs.map((tab) => {
          const isActive = isTabActive(tab, pathname)
          const Icon = tab.icon
          return (
            <li key={tab.href} className="min-w-0 flex-1">
              <Link
                href={tab.href}
                className={cn(
                  'flex min-h-[44px] flex-col items-center justify-center gap-0.5 py-1.5 rounded-md transition-colors duration-200 motion-reduce:transition-none',
                  isActive
                    ? 'text-accent bg-accent-tint'
                    : 'text-label-secondary active:text-label-primary'
                )}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon
                  className={cn(
                    'w-[26px] h-[26px] transition-transform duration-200 motion-reduce:transition-none',
                    isActive && 'scale-105'
                  )}
                  strokeWidth={isActive ? 2.4 : 1.8}
                  aria-hidden="true"
                />
                <span className={cn(
                  'text-[12px] leading-tight whitespace-nowrap',
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
