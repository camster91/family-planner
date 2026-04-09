import { ReactNode } from 'react'
import DashboardNav from '@/components/layout/DashboardNav'
import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { ErrorBoundary } from '@/components/ui/error-boundary'

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode
}) {
  const sessionUser = await getServerUser()

  if (!sessionUser) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900">Not Authenticated</h1>
          <p className="mt-2 text-gray-600">Please sign in to access the dashboard.</p>
        </div>
      </div>
    )
  }

  // Get user profile with gamification data
  const user = await prisma!.user.findUnique({
    where: { id: sessionUser.id },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      age: true,
      family_id: true,
      avatar_url: true,
      points: true,
      level: true,
      xp: true,
      streak: true,
      best_streak: true,
      created_at: true,
    },
  })

  return (
    <div className="min-h-screen bg-gray-50">
      <DashboardNav user={user as any} />
      <div className="pt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <ErrorBoundary>
            {children}
          </ErrorBoundary>
        </div>
      </div>
    </div>
  )
}
