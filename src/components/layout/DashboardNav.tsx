'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  Home,
  Calendar,
  ListChecks,
  Users,
  Search,
  Bell,
  ChevronDown,
  User,
  Users2,
  Settings,
  LogOut,
} from 'lucide-react'
import { User as UserType, UserRole } from '@/types'
import { cn } from '@/lib/utils'
import { Avatar } from '@/components/ui/avatar'
import { TabBar } from '@/components/ui/tab-bar'

interface DashboardNavProps {
  user: UserType | null
}

const PRIMARY_TABS = [
  { href: '/dashboard', label: 'Today', icon: Home, matchPrefix: false },
  { href: '/dashboard/calendar', label: 'Calendar', icon: Calendar, matchPrefix: true },
  { href: '/dashboard/lists', label: 'Lists', icon: ListChecks, matchPrefix: true },
  { href: '/dashboard/family', label: 'Family', icon: Users, matchPrefix: true },
] as const

const ROLE_LABELS: Record<UserRole, string> = {
  parent: 'Parent',
  child: 'Child',
  teen: 'Teen',
}

export default function DashboardNav({ user }: DashboardNavProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [avatarOpen, setAvatarOpen] = useState(false)
  const [roleSwitcherOpen, setRoleSwitcherOpen] = useState(false)
  const avatarRef = useRef<HTMLDivElement>(null)

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (avatarRef.current && !avatarRef.current.contains(e.target as Node)) {
        setAvatarOpen(false)
        setRoleSwitcherOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSignOut = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
    router.refresh()
  }

  const handleRoleSwitch = async (role: UserRole) => {
    // In a real app this would call an API — for now just toggle UI state
    setRoleSwitcherOpen(false)
    // Could refresh or show a toast; the role affects surface rendering via props
  }

  return (
    <>
      {/* ─── Apple HIG Desktop Top Bar ─── */}
      <nav className="glass fixed top-0 left-0 right-0 z-50 h-16 border-b border-[var(--surface-separator)]">
        <div className="max-w-7xl mx-auto h-full px-4 lg:px-8 flex items-center gap-6">
          {/* Logo + name */}
          <Link href="/dashboard" className="flex items-center gap-2.5 shrink-0">
            <div className="w-9 h-9 bg-accent rounded-[22px] flex items-center justify-center shadow-sm">
              <Users className="w-5 h-5 text-white" />
            </div>
            <span className="text-[17px] font-semibold text-label-primary hidden sm:block">
              Family Planner
            </span>
          </Link>

          {/* Primary tabs — lg+ only */}
          <div className="hidden lg:flex items-center gap-1">
            {PRIMARY_TABS.map((tab) => {
              const isActive = tab.matchPrefix
                ? pathname.startsWith(tab.href)
                : pathname === tab.href
              const Icon = tab.icon
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[15px] transition-colors duration-200',
                    isActive
                      ? 'font-semibold text-accent bg-accent/10'
                      : 'font-medium text-label-secondary hover:text-label-primary hover:bg-[var(--surface-secondary)]'
                  )}
                >
                  <Icon className="w-4 h-4" strokeWidth={isActive ? 2.2 : 1.8} />
                  {tab.label}
                </Link>
              )
            })}
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Right-side action cluster — md+ */}
          <div className="flex items-center gap-1">
            {/* Search */}
            <Link
              href="/dashboard/search"
              className="p-2 text-label-secondary hover:text-label-primary rounded-full hover:bg-[var(--surface-secondary)] transition-colors"
              aria-label="Search"
            >
              <Search className="w-5 h-5" />
            </Link>

            {/* Notifications bell */}
            <Link
              href="/dashboard/notifications"
              className="p-2 text-label-secondary hover:text-label-primary rounded-full hover:bg-[var(--surface-secondary)] transition-colors relative"
              aria-label="Notifications"
            >
              <Bell className="w-5 h-5" />
            </Link>

            {/* Avatar + overflow menu */}
            <div className="relative ml-1" ref={avatarRef}>
              <button
                onClick={() => setAvatarOpen((v) => !v)}
                className="flex items-center gap-1.5 p-1 pr-2.5 rounded-full hover:bg-[var(--surface-secondary)] transition-colors"
                aria-label="User menu"
                aria-expanded={avatarOpen}
              >
                <Avatar
                  name={user?.name ?? 'User'}
                  src={user?.avatar_url}
                  size="sm"
                />
                <span className="hidden sm:block text-[14px] font-medium text-label-primary">
                  {user?.name?.split(' ')[0]}
                </span>
                <ChevronDown className={cn(
                  'w-3.5 h-3.5 text-label-tertiary transition-transform duration-200',
                  avatarOpen && 'rotate-180'
                )} />
              </button>

              {/* Overflow dropdown */}
              {avatarOpen && (
                <div className="absolute right-0 top-full mt-2 w-64 card-apple border border-[var(--surface-separator)] animate-spring-in">
                  {/* User info */}
                  <div className="px-4 py-3 border-b border-[var(--surface-separator)]">
                    <p className="text-[15px] font-semibold text-label-primary truncate">
                      {user?.name}
                    </p>
                    <p className="text-[13px] text-label-secondary truncate mt-0.5">
                      {user?.email}
                    </p>
                    <span className={cn(
                      'inline-block mt-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wide',
                      user?.role === 'parent' && 'bg-blue-100 text-blue-700',
                      user?.role === 'teen' && 'bg-purple-100 text-purple-700',
                      user?.role === 'child' && 'bg-green-100 text-green-700',
                    )}>
                      {ROLE_LABELS[user?.role ?? 'child']}
                    </span>
                  </div>

                  {/* Role switcher — shown for all roles so parents can preview */}
                  <div className="px-3 py-2 border-b border-[var(--surface-separator)]">
                    <p className="text-[11px] font-semibold text-label-tertiary uppercase tracking-wider px-1 mb-1.5">
                      Switch View
                    </p>
                    <div className="flex gap-1">
                      {(['parent', 'teen', 'child'] as UserRole[]).map((role) => (
                        <button
                          key={role}
                          onClick={() => handleRoleSwitch(role)}
                          className={cn(
                            'flex-1 py-1.5 rounded-md text-[13px] font-medium transition-colors',
                            user?.role === role
                              ? 'bg-accent text-white'
                              : 'bg-[var(--surface-secondary)] text-label-secondary hover:text-label-primary'
                          )}
                        >
                          {ROLE_LABELS[role]}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Menu items */}
                  <div className="py-1.5">
                    <Link
                      href="/dashboard/profile"
                      className="flex items-center gap-3 px-4 py-2.5 text-[15px] text-label-primary hover:bg-[var(--surface-secondary)] transition-colors"
                      onClick={() => setAvatarOpen(false)}
                    >
                      <User className="w-4 h-4 text-label-secondary" />
                      Profile
                    </Link>
                    <Link
                      href="/dashboard/family"
                      className="flex items-center gap-3 px-4 py-2.5 text-[15px] text-label-primary hover:bg-[var(--surface-secondary)] transition-colors"
                      onClick={() => setAvatarOpen(false)}
                    >
                      <Users2 className="w-4 h-4 text-label-secondary" />
                      Family
                    </Link>
                    <Link
                      href="/dashboard/settings"
                      className="flex items-center gap-3 px-4 py-2.5 text-[15px] text-label-primary hover:bg-[var(--surface-secondary)] transition-colors"
                      onClick={() => setAvatarOpen(false)}
                    >
                      <Settings className="w-4 h-4 text-label-secondary" />
                      Settings
                    </Link>
                  </div>

                  {/* Sign out */}
                  <div className="py-1.5 border-t border-[var(--surface-separator)]">
                    <button
                      onClick={handleSignOut}
                      className="flex items-center gap-3 px-4 py-2.5 w-full text-[15px] text-red-600 hover:bg-red-50 transition-colors"
                    >
                      <LogOut className="w-4 h-4" />
                      Sign Out
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* ─── Mobile bottom TabBar (handled inside layout, but exported here for reuse) ─── */}
      {/* The TabBar is rendered in layout.tsx, not here, to avoid double-rendering */}
    </>
  )
}

// Re-export TabBar so layout.tsx can import it from here
export { TabBar }