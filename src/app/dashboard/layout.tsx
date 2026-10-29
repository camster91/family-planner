import { storageBackend } from "@/lib/storage-backend";
import { getD1Database } from "@/lib/cloudflare/database";
import { readD1DashboardShell } from "@/lib/cloudflare/dashboard-shell";
import { FoodPlanningAccess } from "@/components/meals/planning/FoodPlanningAccess";
import { foodPlanningEnabled } from "@/lib/food-planning/server";
import { isProfileChoreEnabled } from "@/lib/profile-chore-gates";
import { isAssistantConfirmationEnabled } from "@/lib/assistant-source-proof";
import PreparationProvider from "@/components/calendar/preparation/PreparationProvider";
import { eventPreparationReady } from "@/lib/event-preparation/owner";
import { Suspense } from "react";
import ScheduleReviewProvider from "@/components/calendar/review/ScheduleReviewProvider";
import { scheduleReviewReady } from "@/lib/calendar-planning/schedule-owner";
import ResponsibilityProvider from "@/components/responsibility/ResponsibilityProvider";
import { responsibilityReady } from "@/lib/responsibility-owner";
import AssistantHost from "@/components/assistant/AssistantHost";
import { ReactNode } from "react";
import {
  SignedOutDashboard,
  DashboardSkipLink,
  DashboardMainLabel,
} from "@/components/layout/DashboardRecoveryCopy";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import DashboardNav, { TabBar } from "@/components/layout/DashboardNav";
import { getServerUser } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { OfflineBanner } from "@/components/ui/offline-banner";
import CommandPaletteHost from "@/components/layout/CommandPaletteHost";
import { DisplayPreferencesProvider } from "@/components/providers/display-preferences-provider";
import { FeaturesProvider } from "@/components/providers/features-provider";
import { defaultFeatures, normalizeFeatures } from "@/lib/feature-flags";
import { canRoleAccessPath, isKidRole } from "@/lib/kid-access";
import type { NavUser, UserRole } from "@/types";
import { isAssistantTodayEnabled } from "@/lib/assistant-today-capability";

function toUserRole(role: string | null | undefined): UserRole {
  return role === "teen" || role === "child" ? role : "parent";
}

export default async function DashboardLayout({
  children,
  forms,
}: {
  children: ReactNode;
  forms: ReactNode;
}) {
  const sessionUser = (await getServerUser()) as {
    id: string;
    email: string;
    role?: string;
    family_id?: string | null;
  } | null;

  if (!sessionUser) return <SignedOutDashboard />;

  // Look up the role (don't trust the JWT for this — do a fresh DB read so
  // role changes take effect immediately and the layout is the source of truth).
  // The same read supplies the nav's fields (#241): only what the nav renders,
  // never email, age, family id, XP, level or streak. These props are
  // serialised into every dashboard page, including
  // /dashboard/today?mode=fridge on a tablet signed in as a person.
  const profileSelect = {
    id: true,
    name: true,
    role: true,
    avatar_url: true,
    family_id: true,
  } as const;
  const nativeShell =
    storageBackend() === "d1"
      ? await readD1DashboardShell(
          await getD1Database(),
          sessionUser.id,
          sessionUser.family_id ?? null,
        )
      : null;
  const profile =
    storageBackend() === "d1"
      ? nativeShell?.profile
      : await prisma!.user.findUnique({
          where: { id: sessionUser.id },
          select: profileSelect,
        });
  if (storageBackend() === "d1" && !profile) return <SignedOutDashboard />;
  const role = profile?.role || sessionUser.role || "parent";

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
    const hdrs = await headers();
    const route = hdrs.get("x-pathname") || "";
    // If we cannot determine the route, allow it: the middleware ran first and
    // already enforced the allowlist. Failing closed here would lock kids out
    // of their own dashboard.
    if (route && !canRoleAccessPath(role, route)) {
      redirect("/dashboard");
    }
  }

  const navUser: NavUser | null = profile
    ? {
        id: profile.id,
        name: profile.name,
        role: toUserRole(profile.role),
        avatar_url: profile.avatar_url,
      }
    : null;

  // Get user's family features so the client can hydrate without a roundtrip
  const familyFeatures = sessionUser?.family_id
    ? storageBackend() === "d1"
      ? nativeShell?.familyFeatures
      : await prisma!.family.findUnique({
          where: { id: sessionUser.family_id },
          select: { features: true },
        })
    : null;
  const initialFeatures = familyFeatures?.features
    ? normalizeFeatures(familyFeatures.features)
    : defaultFeatures();

  return (
    <div
      data-dashboard-shell
      className="min-h-screen bg-[var(--surface-grouped)] pb-[max(5rem,var(--phone-tab-bar-height,0px))] md:pb-0"
    >
      {/* Inline seed for the client-side FeaturesProvider.
          Safe JSON — only true/false per known feature key. */}
      <script
        id="family-features"
        type="application/json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(initialFeatures) }}
      />

      <DisplayPreferencesProvider
        key={sessionUser.id}
        viewerId={sessionUser.id}
      >
        <FeaturesProvider
          initial={initialFeatures}
          canManage={role === "parent"}
        >
          <Suspense fallback={null}>
            <PreparationProvider enabled={eventPreparationReady()} role={role}>
              <ScheduleReviewProvider
                enabled={scheduleReviewReady()}
                role={role}
              >
                <ResponsibilityProvider
                  enabled={responsibilityReady()}
                  role={role}
                >
                  <div data-dashboard-background>
                    {/* Skip-to-content link for keyboard users (WCAG 2.4.1) */}
                    <DashboardSkipLink />

                    {/* Apple HIG top bar nav */}
                    <DashboardNav user={navUser} />

                    {/* Main content — the shell reserves bottom-tab clearance once, after all content. */}
                    <main
                      id="main-content"
                      className="pt-16 pb-4"
                      aria-labelledby="dashboard-main-label"
                    >
                      <DashboardMainLabel />
                      {/* "You're offline" (O-41): sticky under the top bar, above the tab bar's area. */}
                      <OfflineBanner className="top-16" />
                      <div className="w-full px-4 sm:px-6 lg:px-8 py-5 md:py-6">
                        <FoodPlanningAccess
                          enabled={foodPlanningEnabled()}
                          role={role}
                        >
                          <ErrorBoundary>{children}</ErrorBoundary>
                        </FoodPlanningAccess>
                      </div>
                    </main>

                    {/* Mobile-only bottom tab bar */}
                    <TabBar user={navUser} />

                    {/* Cmd+K global search palette */}
                    <CommandPaletteHost role={role} />
                  </div>
                  {navUser && (
                    <Suspense fallback={null}>
                      <AssistantHost
                        key={`${profile?.id}:${profile?.family_id}`}
                        role={role}
                        todayContextEnabled={isAssistantTodayEnabled()}
                        confirmationEnabled={isAssistantConfirmationEnabled()}
                        profileAssignmentEnabled={
                          isProfileChoreEnabled() &&
                          process.env.HOUSEHOLD_PROFILE_SETUP_ENABLED === "1"
                        }
                      />
                    </Suspense>
                  )}
                  {forms}
                </ResponsibilityProvider>
              </ScheduleReviewProvider>
            </PreparationProvider>
          </Suspense>
        </FeaturesProvider>
      </DisplayPreferencesProvider>
    </div>
  );
}
