'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Home,
  Calendar,
  CheckSquare,
  MessageSquare,
  Users,
  Settings,
  LogOut,
  Menu,
  X,
  Trophy,
  List,
  BarChart3,
  Flame,
  Star
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { User } from '@/types'
import NotificationBell from '@/components/notifications/NotificationBell'

interface DashboardNavProps {
  user: User | null
}

export default function DashboardNav({ user }: DashboardNavProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const pathname = usePathname()
  const router = useRouter()

  const navigation = [
    { name: 'Dashboard', href: '/dashboard', icon: Home },
    { name: 'Chores', href: '/dashboard/chores', icon: CheckSquare },
    { name: 'Rewards', href: '/dashboard/rewards', icon: Trophy },
    { name: 'Analytics', href: '/dashboard/analytics', icon: BarChart3 },
    { name: 'Lists', href: '/dashboard/lists', icon: List },
    { name: 'Calendar', href: '/dashboard/calendar', icon: Calendar },
    { name: 'Messages', href: '/dashboard/messages', icon: MessageSquare },
    { name: 'Family', href: '/dashboard/family', icon: Users },
    { name: 'Settings', href: '/dashboard/settings', icon: Settings },
  ]

  const handleSignOut = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
    router.refresh()
  }

  return (
    <nav className="bg-white shadow-sm border-b fixed w-full z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          {/* Logo and desktop navigation */}
          <div className="flex items-center">
            <div className="flex-shrink-0 flex items-center">
              <Link href="/dashboard" className="flex items-center">
                <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                  <Users className="w-5 h-5 text-white" />
                </div>
                <span className="ml-2 text-xl font-bold text-gray-900">Family Planner</span>
              </Link>
            </div>

            <div className="hidden md:ml-8 md:flex md:space-x-1">
              {navigation.map((item) => {
                const isActive = pathname === item.href
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    className={`inline-flex items-center px-3 py-2 rounded-md text-sm font-medium ${
                      isActive
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900'
                    }`}
                  >
                    <item.icon className="w-4 h-4 mr-2" />
                    {item.name}
                  </Link>
                )
              })}
            </div>
          </div>

          {/* Right side: notifications and user menu */}
          <div className="flex items-center">
            {/* Notifications */}
            <NotificationBell />

            {/* User menu */}
            <div className="ml-3 relative">
              <div className="flex items-center space-x-3">
                {/* Gamification mini-stats */}
                <div className="hidden lg:flex items-center gap-3 mr-2 text-xs">
                  {(user as any)?.streak > 0 && (
                    <div className="flex items-center gap-1 bg-orange-50 text-orange-600 px-2 py-1 rounded-full font-medium">
                      <Flame className="w-3.5 h-3.5" />
                      {(user as any).streak}d
                    </div>
                  )}
                  {(user as any)?.level > 0 && (
                    <div className="flex items-center gap-1 bg-purple-50 text-purple-600 px-2 py-1 rounded-full font-medium">
                      <Star className="w-3.5 h-3.5" />
                      Lv.{(user as any).level}
                    </div>
                  )}
                </div>
                <div className="text-sm text-right hidden md:block">
                  <div className="font-medium text-gray-900">{user?.name}</div>
                  <div className="text-gray-500 capitalize">{user?.role}</div>
                </div>
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-semibold">
                    {user?.name?.charAt(0).toUpperCase() || 'U'}
                  </div>
                </div>
                <button
                  onClick={handleSignOut}
                  className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-md"
                  title="Sign out"
                >
                  <LogOut className="w-5 h-5" />
                  <span className="sr-only">Sign out</span>
                </button>
              </div>
            </div>

            {/* Mobile menu button */}
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="md:hidden ml-2 p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-md"
            >
              {isMobileMenuOpen ? (
                <X className="w-6 h-6" />
              ) : (
                <Menu className="w-6 h-6" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      {isMobileMenuOpen && (
        <div className="md:hidden border-t">
          <div className="px-2 pt-2 pb-3 space-y-1">
            {navigation.map((item) => {
              const isActive = pathname === item.href
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={`flex items-center px-3 py-2 rounded-md text-base font-medium ${
                    isActive
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900'
                  }`}
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  <item.icon className="w-5 h-5 mr-3" />
                  {item.name}
                </Link>
              )
            })}
          </div>
          <div className="pt-4 pb-3 border-t">
            <div className="flex items-center px-4">
              <div className="flex-shrink-0">
                <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-semibold text-lg">
                  {user?.name?.charAt(0).toUpperCase() || 'U'}
                </div>
              </div>
              <div className="ml-3">
                <div className="text-base font-medium text-gray-900">{user?.name}</div>
                <div className="text-sm text-gray-500 capitalize">{user?.role}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </nav>
  )
}
