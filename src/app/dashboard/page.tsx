import { after } from 'next/server'
import { redirect } from 'next/navigation'
import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { isFeatureEnabled, normalizeFeatures } from '@/lib/features'
import { omitChorePoints, omitUserGamification } from '@/lib/gamification-visibility'
import { isKidRole } from '@/lib/kid-access'
import { refreshStaleSubscriptions } from '@/lib/calendar-import/sync'
import { addUTCDays, startOfTodayUTC } from '@/lib/dates'
import KidHome from '@/components/dashboard/KidHome'

import OnboardingFlow from '@/components/onboarding/OnboardingFlow'

/** Cap on the kid's chores in the yesterday..day-after-tomorrow window. */
const MAX_WINDOW_CHORES = 60
/** Open chores from before that window: KidHome shows a few of these. */
const MAX_OLDER_CHORES = 3

/**
 * `/dashboard` (#269 "one home").
 *
 * - No household yet: onboarding.
 * - Parents: the home is the Today board, `/dashboard/today`, on every
 *   viewport. This route redirects there so old links, the login redirect and
 *   installed Android bundles keep working.
 * - Children and teens: the kid home stays here (their own missions, and
 *   level/rewards when Points & streaks is on). It differs from the board on
 *   purpose; their Today tab points here and the board stays one tap away in
 *   the user menu. See docs/product/NAVIGATION.md.
 */
export default async function DashboardPage() {
  const sessionUser = await getServerUser()

  if (!sessionUser) {
    return null
  }

  const user = await prisma!.user.findUnique({
    where: { id: sessionUser.id },
    select: {
      id: true,
      name: true,
      role: true,
      family_id: true,
      avatar_url: true,
      xp: true,
      level: true,
      family: { select: { features: true } },
    },
  })

  // Show onboarding if user has no family
  if (!user?.family_id) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center">
        <OnboardingFlow userId={sessionUser.id} />
      </div>
    )
  }

  if (!isKidRole(user.role)) {
    redirect('/dashboard/today')
  }

  const familyId = user.family_id
  const features = normalizeFeatures(user.family?.features)
  // Points & streaks (#248). When off, no XP / level / chore-points value is
  // put into the client props below, so none reaches the HTML or RSC payload.
  const gamification = features.gamification
  const rewardsOn = isFeatureEnabled(features, 'rewards')

  // Subscribed calendars (#232): refresh stale feeds after the response is sent.
  after(() => refreshStaleSubscriptions(familyId))
  const now = new Date()

  // Due dates are UTC-midnight date-only values (O-31). Yesterday..the day
  // after tomorrow (UTC) covers the viewer's local today and tomorrow in every
  // zone; KidHome picks the local day. Recurring chores keep future copies, so
  // this must stay bounded: no week of tomorrows posing as today's missions.
  const todayUTC = startOfTodayUTC(now)
  const windowStart = addUTCDays(todayUTC, -1)
  const windowEnd = addUTCDays(todayUTC, 2)

  const [windowChores, olderOpenChores, events, rewards] = await Promise.all([
    // Own chores only. Explicit, total order (#155).
    prisma!.chore.findMany({
      where: { family_id: familyId, assigned_to: sessionUser.id, due_date: { gte: windowStart, lte: windowEnd } },
      orderBy: [{ due_date: 'asc' }, { id: 'asc' }],
      take: MAX_WINDOW_CHORES,
    }),
    // A few still-open chores from before the window, most recent first; the
    // kid home shows at most KID_OLDER_CHORES of them.
    prisma!.chore.findMany({
      where: {
        family_id: familyId,
        assigned_to: sessionUser.id,
        due_date: { lt: windowStart },
        status: { in: ['pending', 'in_progress', 'overdue'] },
      },
      orderBy: [{ due_date: 'desc' }, { id: 'desc' }],
      take: MAX_OLDER_CHORES,
    }),
    prisma!.event.findMany({
      where: { family_id: familyId, start_time: { gte: now } },
      orderBy: { start_time: 'asc' },
      take: 5,
    }),
    // With Rewards off (or Points & streaks off, which it needs) the claim
    // endpoint 403s, so no card is offered.
    rewardsOn
      ? prisma!.reward.findMany({
          where: { family_id: familyId, status: 'available' },
          orderBy: { created_at: 'desc' },
          take: 5,
        })
      : Promise.resolve([]),
  ])

  // Only what KidHome draws; the household's feature blob stays on the server.
  const kid = { id: user.id, name: user.name, role: user.role, avatar_url: user.avatar_url, family_id: familyId, xp: user.xp, level: user.level }
  const viewer = gamification ? kid : omitUserGamification(kid)
  const chores = [...olderOpenChores.reverse(), ...windowChores]
  const visibleChores = gamification ? chores : chores.map(omitChorePoints)

  return (
    <KidHome
      user={viewer as any}
      chores={visibleChores as any}
      events={events as any}
      rewards={rewards.map((r) => ({
        id: r.id,
        name: r.name,
        cost: r.cost,
        description: r.description || undefined,
        status: r.status as 'available' | 'claimed' | 'approved' | 'redeemed',
      }))}
    />
  )
}
