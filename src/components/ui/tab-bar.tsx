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
  const navRef = React.useRef<HTMLElement>(null)

  React.useEffect(() => {
    const nav = navRef.current
    const main = document.getElementById('main-content')
    if (!nav || !main || typeof ResizeObserver === 'undefined') return

    // The layout keeps its normal 5rem reserve, but enlarged/wrapped labels
    // can make the fixed bar taller. Include the border and react to font,
    // feature and viewport changes (including display:none above md).
    const property = '--phone-tab-bar-height'
    const previous = main.style.getPropertyValue(property)
    const measure = () => main.style.setProperty(property, `${nav.getBoundingClientRect().height}px`)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(nav)
    return () => {
      observer.disconnect()
      if (previous) main.style.setProperty(property, previous)
      else main.style.removeProperty(property)
    }
  }, [])

  return (
    <nav ref={navRef} className="tab-bar md:hidden" aria-label="Tabs">
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
                  'min-w-0 max-w-full text-center text-[12px] leading-tight whitespace-normal break-words',
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
