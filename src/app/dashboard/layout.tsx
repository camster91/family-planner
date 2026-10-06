import { ReactNode } from 'react'
import { PRODUCT_BRAND } from '@/lib/brand'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import DashboardNav, { TabBar } from '@/components/layout/DashboardNav'
import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { ErrorBoundary } from '@/components/ui/error-boundary'
import { OfflineBanner } from '@/components/ui/offline-banner'
import CommandPaletteHost from '@/components/layout/CommandPaletteHost'
import { FeaturesProvider } from '@/components/providers/features-provider'
import { defaultFeatures, normalizeFeatures } from '@/lib/features'
import { canRoleAccessPath, isKidRole } from '@/lib/kid-access'
import type { NavUser, UserRole } from '@/types'

function toUserRole(role: string | null | undefined): UserRole {
  return role === 'teen' || role === 'child' ? role : 'parent'
}

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
          <h1 className="text-2xl font-bold text-foreground">Not Authenticated</h1>
          <p className="mt-2 text-muted-foreground">Please sign in to access the dashboard.</p>
        </div>
      </div>
    )
  }

  // Look up the role (don't trust the JWT for this — do a fresh DB read so
  // role changes take effect immediately and the layout is the source of truth).
  // The same read supplies the nav's fields (#241): only what the nav renders,
  // never email, age, family id, XP, level or streak. These props are
  // serialised into every dashboard page, including
  // /dashboard/today?mode=fridge on a tablet signed in as a person.
  const profile = await prisma!.user.findUnique({
    where: { id: sessionUser.id },
    select: { id: true, name: true, role: true, avatar_url: true },
  })
  const role = profile?.role || sessionUser.role || 'parent'

  // Server-side role gate, second line of defence behind the middleware
  // (src/middleware.ts). Both read the SAME allowlist from src/lib/kid-access.ts,
  // so they cannot disagree.
  //
  // Previously this read `x-pathname` / `x-invoke-path`, which Next.js never
  // sends to layouts — so the check always fell through and the gate never fired.
  // That is why kids could reach sub-routes the comment claimed were blocked.
  //
  // The pathname comes from the `x-pathname` request header the middleware
  // sets (and overwrites) on every request it forwards. There is no Referer
  // fallback: the Referer is the PREVIOUS page (or another site), so guessing
  // from it bounced kids to /dashboard after login or from external links.
  if (isKidRole(role)) {
    const hdrs = await headers()
    const route = hdrs.get('x-pathname') || ''
    // If we cannot determine the route, allow it: the middleware ran first and
    // already enforced the allowlist. Failing closed here would lock kids out
    // of their own dashboard.
    if (route && !canRoleAccessPath(role, route)) {
      redirect('/dashboard')
    }
  }

  const navUser: NavUser | null = profile
    ? { id: profile.id, name: profile.name, role: toUserRole(profile.role), avatar_url: profile.avatar_url }
    : null

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
    <div className="min-h-screen bg-[var(--surface-grouped)]">
      {/* Inline seed for the client-side FeaturesProvider.
          Safe JSON — only true/false per known feature key. */}
      <script
        id="family-features"
        type="application/json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(initialFeatures) }}
      />

      <FeaturesProvider initial={initialFeatures} canManage={role === 'parent'}>
        {/* Skip-to-content link for keyboard users (WCAG 2.4.1) */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:px-4 focus:py-2 focus:rounded-full focus:bg-[var(--tint-family)] focus:text-white focus:text-subhead focus:font-semibold focus:shadow-[var(--shadow-lg)]"
        >
          Skip to main content
        </a>

        {/* Apple HIG top bar nav */}
        <DashboardNav user={navUser} />

        {/* Main content — padded for top bar height + TabBar safe area on mobile */}
        <main
          id="main-content"
          className="pt-16 pb-20 md:pb-8"
          aria-label={`${PRODUCT_BRAND.name} dashboard`}
        >
          {/* "You're offline" (O-41): sticky under the top bar, above the tab bar's area. */}
          <OfflineBanner className="top-16" />
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 md:py-6">
            <ErrorBoundary>
              {children}
            </ErrorBoundary>
          </div>
        </main>

        {/* Mobile-only bottom tab bar */}
        <TabBar user={navUser} />

        {/* Cmd+K global search palette */}
        <CommandPaletteHost role={role} />
      </FeaturesProvider>
    </div>
  )
}