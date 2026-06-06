import { ReactNode } from 'react'
import DashboardNav, { TabBar } from '@/components/layout/DashboardNav'
import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { ErrorBoundary } from '@/components/ui/error-boundary'
import CommandPaletteHost from '@/components/layout/CommandPaletteHost'
import { FeaturesProvider } from '@/components/providers/features-provider'
import { defaultFeatures, normalizeFeatures } from '@/lib/features'

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode
}) {
  const sessionUser = (await getServerUser()) as {
    id: string
    email: string
    role?: string
    family_id?: string | null
  } | null

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

  // Get user profile
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
      xp: true,
      level: true,
      streak: true,
      created_at: true,
    },
  })

  // Get user's family features so the client can hydrate without a roundtrip
  const familyFeatures = sessionUser?.family_id
    ? await prisma!.family.findUnique({
        where: { id: sessionUser.family_id },
        select: { features: true },
      })
    : null
  const initialFeatures = familyFeatures?.features
    ? normalizeFeatures(familyFeatures.features)
    : defaultFeatures()

  return (
    <div className="min-h-screen bg-[var(--background)]">
      {/* Inline seed for the client-side FeaturesProvider.
          Safe JSON — only true/false per known feature key. */}
      <script
        id="family-features"
        type="application/json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(initialFeatures) }}
      />

      <FeaturesProvider>
        {/* Apple HIG top bar nav */}
        <DashboardNav user={user as any} />

        {/* Main content — padded for top bar height + TabBar safe area on mobile */}
        <div className="pt-16 pb-20 md:pb-8">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <ErrorBoundary>
              {children}
            </ErrorBoundary>
          </div>
        </div>

        {/* Mobile-only bottom tab bar */}
        <TabBar user={user as any} />

        {/* Cmd+K global search palette */}
        <CommandPaletteHost />
      </FeaturesProvider>
    </div>
  )
}