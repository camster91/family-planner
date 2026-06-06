import { ReactNode } from 'react'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
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

  // Look up the role (don't trust the JWT for this — do a fresh DB read so
  // role changes take effect immediately and the layout is the source of truth).
  const dbUser = await prisma!.user.findUnique({
    where: { id: sessionUser.id },
    select: { role: true },
  })
  const role = dbUser?.role || sessionUser.role || 'parent'

  // Server-side role gate: kids and teens can only see the KidHome (which is
  // rendered by /dashboard/page.tsx). Any /dashboard/* sub-route is parent-only
  // and kids get redirected back to /dashboard. This prevents a kid from
  // bypassing the KidHome routing by typing /dashboard/features directly.
  if ((role === 'child' || role === 'teen')) {
    const hdrs = await headers()
    const pathname = hdrs.get('x-pathname') || hdrs.get('x-invoke-path') || ''
    // x-invoke-path is the most reliable in Next 14 layouts
    const referer = hdrs.get('referer') || ''
    // Use x-pathname header (set by middleware) or fall back to referer
    let route = pathname
    if (!route) {
      try {
        route = new URL(referer).pathname
      } catch { /* ignore */ }
    }
    if (!route || route === '/dashboard' || route === '/dashboard/') {
      // Allowed: KidHome renders here
    } else {
      // Block any sub-route
      redirect('/dashboard')
    }
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
        {/* Skip-to-content link for keyboard users (WCAG 2.4.1) */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:px-4 focus:py-2 focus:rounded-full focus:bg-[var(--tint-family)] focus:text-white focus:text-subhead focus:font-semibold focus:shadow-[var(--shadow-lg)]"
        >
          Skip to main content
        </a>

        {/* Apple HIG top bar nav */}
        <DashboardNav user={user as any} />

        {/* Main content — padded for top bar height + TabBar safe area on mobile */}
        <main
          id="main-content"
          className="pt-16 pb-20 md:pb-8"
          aria-label="Family planner dashboard"
        >
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <ErrorBoundary>
              {children}
            </ErrorBoundary>
          </div>
        </main>

        {/* Mobile-only bottom tab bar */}
        <TabBar user={user as any} />

        {/* Cmd+K global search palette */}
        <CommandPaletteHost />
      </FeaturesProvider>
    </div>
  )
}