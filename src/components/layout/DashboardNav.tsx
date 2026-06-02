'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
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
  List,
  BarChart3,
  Zap,
  Gift,
  Wallet,
  FolderKanban,
} from 'lucide-react'
import { User } from '@/types'
import { useTranslation } from '@/i18n'

interface DashboardNavProps {
  user: User | null
}

export default function DashboardNav({ user }: DashboardNavProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const pathname = usePathname()
  const router = useRouter()
  const { t } = useTranslation()

  const navigation = [
    { name: t('nav.dashboard'), href: '/dashboard', icon: Home },
    { name: t('nav.chores'), href: '/dashboard/chores', icon: CheckSquare },
    { name: 'Rewards', href: '/dashboard/rewards', icon: Gift },
    { name: 'Budget', href: '/dashboard/budget', icon: Wallet },
    { name: 'Projects', href: '/dashboard/projects', icon: FolderKanban },
    { name: t('nav.analytics'), href: '/dashboard/analytics', icon: BarChart3 },
    { name: t('nav.lists'), href: '/dashboard/lists', icon: List },
    { name: t('nav.calendar'), href: '/dashboard/calendar', icon: Calendar },
    { name: t('nav.messages'), href: '/dashboard/messages', icon: MessageSquare },
    { name: t('nav.family'), href: '/dashboard/family', icon: Users },
    { name: t('nav.settings'), href: '/dashboard/settings', icon: Settings },
  ]

  const handleSignOut = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
    router.refresh()
  }

  return (
    <nav className="bg-white shadow-sm border-b fixed w-full z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16 pr-4">
          {/* Logo and desktop navigation */}
          <div className="flex items-center">
            <div className="flex-shrink-0 flex items-center">
              <Link href="/dashboard" className="flex items-center">
                <div className="w-8 h-8 bg-teal-500 rounded-xl flex items-center justify-center shadow-sm shadow-teal-200">
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
                    className={`inline-flex items-center px-2.5 py-2 rounded-md text-sm font-medium whitespace-nowrap ${
                      isActive
                        ? 'bg-teal-50 text-teal-700'
                        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                    }`}
                  >
                    <item.icon className="w-4 h-4 mr-1.5" />
                    <span className="hidden lg:inline">{item.name}</span>
                    <span className="lg:hidden">{item.name.charAt(0)}</span>
                  </Link>
                )
              })}
            </div>
          </div>

          {/* Right side: user menu + XP */}
          <div className="flex items-center gap-2">
            {/* XP Badge - visible on all screens */}
            <div className="flex items-center gap-1.5 bg-teal-50 px-2.5 py-1 rounded-xl">
              <Zap className="w-3.5 h-3.5 text-teal-600" />
              <span className="text-xs font-semibold text-teal-700">{(user as any)?.xp || 0} XP</span>
              <span className="text-xs text-teal-400 hidden sm:inline">• L{(user as any)?.level || 1}</span>
            </div>

            <div className="ml-1 relative">
              <div className="flex items-center space-x-2">
                <div className="text-sm text-right hidden md:block">
                  <div className="font-medium text-gray-900">{user?.name}</div>
                  <div className="text-gray-500 text-xs capitalize">{user?.role}</div>
                </div>
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 rounded-full bg-teal-100 flex items-center justify-center text-teal-600 font-semibold">
                    {user?.name?.charAt(0).toUpperCase() || 'U'}
                  </div>
                </div>
                <button
                  onClick={handleSignOut}
                  className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-md"
                  title={t('nav.signOut')}
                >
                  <LogOut className="w-5 h-5" />
                  <span className="sr-only">{t('nav.signOut')}</span>
                </button>
              </div>
            </div>

            {/* Mobile menu button */}
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="md:hidden ml-1 p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-md"
              aria-label="Toggle menu"
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

      {/* Mobile slide-out menu */}
      <div
        className={`md:hidden fixed inset-0 z-50 transform transition-transform duration-200 ease-in-out ${
          isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="absolute inset-0 bg-black/20" onClick={() => setIsMobileMenuOpen(false)} />
        <div className="absolute left-0 top-0 bottom-0 w-72 bg-white shadow-xl flex flex-col">
          <div className="p-4 border-b flex items-center justify-between">
            <span className="font-bold text-lg">Menu</span>
            <button onClick={() => setIsMobileMenuOpen(false)} className="p-2 hover:bg-gray-50 rounded-md">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto py-2">
            {navigation.map((item) => {
              const isActive = pathname === item.href
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={`flex items-center px-4 py-3 text-base font-medium ${
                    isActive
                      ? 'bg-teal-50 text-teal-700 border-r-4 border-teal-500'
                      : 'text-gray-600 hover:bg-gray-50'
                  }`}
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  <item.icon className="w-5 h-5 mr-3" />
                  {item.name}
                </Link>
              )
            })}
          </div>
          <div className="p-4 border-t">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-teal-100 flex items-center justify-center text-teal-600 font-semibold text-lg">
                {user?.name?.charAt(0).toUpperCase() || 'U'}
              </div>
              <div>
                <div className="font-medium text-gray-900">{user?.name}</div>
                <div className="text-sm text-gray-500 capitalize">{user?.role} • L{(user as any)?.level || 1}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </nav>
  )
}