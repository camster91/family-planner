import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { normalizeFeatures } from '@/lib/features'
import { utcMonthRange } from '@/lib/dates'
import DashboardHome, { type BudgetSnapshot } from '@/components/dashboard/DashboardHome'
import KidHome from '@/components/dashboard/KidHome'

import OnboardingFlow from '@/components/onboarding/OnboardingFlow'
import AdminControlsWrapper from '@/components/admin/AdminControlsWrapper'


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
      family: {
        select: {
          id: true,
          name: true,
          invite_code: true,
          subscription_tier: true,
          features: true,
          travel_mode_active: true,
          travel_start_date: true,
          travel_end_date: true,
          travel_destination: true,
        },
      },
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

  const familyId = user.family_id
  const isKid = user.role === 'child' || user.role === 'teen'
  const now = new Date()
  const inOneWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

  // Get chores (own for kids, all family for parents) + photo-verify queue
  const choresWhere = isKid
    ? { family_id: familyId, assigned_to: sessionUser.id }
    : { family_id: familyId }
  const [chores, events, messages, familyMembers, pickups, allowancePending, anniversaries, photoVerifyQueue, rewards] =
    await Promise.all([
      // Explicit, total order: without it rows come back in physical order, which
      // changes whenever a row is updated (flaky UI order and visual baselines, #155).
      prisma!.chore.findMany({ where: choresWhere, orderBy: [{ due_date: 'asc' }, { id: 'asc' }] }),
      prisma!.event.findMany({
        where: { family_id: familyId, start_time: { gte: now } },
        orderBy: { start_time: 'asc' },
        take: 5,
      }),
      prisma!.message.findMany({
        where: {
          family_id: familyId,
          NOT: { read_by: { has: sessionUser.id } },
        },
        take: 10,
      }),
      prisma!.user.findMany({
        where: { family_id: familyId },
        // Tie-break equal XP by id so the family row does not reshuffle between loads.
        orderBy: [{ xp: 'desc' }, { id: 'asc' }],
        select: { id: true, name: true, xp: true, level: true, streak: true, best_streak: true, avatar_url: true, role: true },
      }),
      prisma!.pickup.findMany({
        where: { family_id: familyId, completed: false, pickup_time: { gte: now } },
        include: { assignee: { select: { id: true, name: true, avatar_url: true } } },
        orderBy: { pickup_time: 'asc' },
        take: 5,
      }),
      prisma!.allowance.findMany({
        where: { family_id: familyId, status: 'pending' },
        include: { to_user: { select: { id: true, name: true, avatar_url: true } } },
        orderBy: { created_at: 'desc' },
        take: 3,
      }),
      prisma!.anniversary.findMany({
        where: { family_id: familyId },
        orderBy: { date: 'asc' },
        take: 10,
      }),
      isKid ? Promise.resolve([]) : prisma!.chore.findMany({
        where: { family_id: familyId, status: 'completed', photo_verified: false },
        include: { assignee: { select: { id: true, name: true, avatar_url: true } } },
        orderBy: { completed_at: 'desc' },
        take: 5,
      }),
      isKid
        ? prisma!.reward.findMany({
            where: { family_id: familyId, status: 'available' },
            orderBy: { created_at: 'desc' },
            take: 5,
          })
        : Promise.resolve([]),
    ])

  const leaderboard = familyMembers.map((m, i) => ({
    rank: i + 1,
    id: m.id,
    name: m.name,
    xp: m.xp || 0,
    level: m.level || 1,
    streak: m.streak || 0,
    bestStreak: m.best_streak || 0,
    avatar: m.avatar_url,
    role: m.role,
  }))

  // Chore progress ("X of Y done today", "My chores") is derived in DashboardHome
  // from `chores`, against the viewer's local calendar day.
  const stats = {
    upcomingEvents: events?.length || 0,
    unreadMessages: messages?.length || 0,
  }

  // Anniversaries coming up in the next 90 days (parent only — kids don't need this)
  const upcomingAnniversaries = !isKid
    ? anniversaries
        .map((a) => {
          const thisYear = new Date(now.getFullYear(), a.date.getMonth(), a.date.getDate())
          const next = thisYear < now
            ? new Date(now.getFullYear() + 1, a.date.getMonth(), a.date.getDate())
            : thisYear
          const days = Math.ceil((next.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
          return { ...a, _days: days }
        })
        .filter((a) => a._days <= 90)
    : []

  // With the rewards feature off, the claim endpoint 403s — suppress the card
  // instead of rendering an action that can only fail.
  const features = normalizeFeatures(user.family?.features)
  const rewardsForKid = features.rewards
    ? rewards.map(r => ({
        id: r.id,
        name: r.name,
        cost: r.cost,
        description: r.description || undefined,
        status: r.status as 'available' | 'claimed' | 'approved' | 'redeemed',
      }))
    : []

  // Budget snapshot: parents only, and only with the budget feature on (the
  // same gates as /api/budget/stats). Same source as that route: this UTC
  // month's expense total against the sum of expense category limits.
  let budget: BudgetSnapshot | null = null
  if (user.role === 'parent' && features.budget) {
    const { start: monthStart, end: monthEnd } = utcMonthRange(now.getUTCFullYear(), now.getUTCMonth() + 1)
    const [expenses, limits] = await Promise.all([
      prisma!.transaction.aggregate({
        where: { family_id: familyId, type: 'expense', date: { gte: monthStart, lt: monthEnd } },
        _sum: { amount: true },
      }),
      prisma!.budgetCategory.aggregate({
        where: { family_id: familyId, type: 'expense' },
        _sum: { budget_limit: true },
      }),
    ])
    budget = {
      spent: Math.round((expenses._sum.amount ?? 0) * 100) / 100,
      limit: Math.round((limits._sum.budget_limit ?? 0) * 100) / 100,
    }
  }

  if (isKid) {
    return (
      <KidHome
        user={user as any}
        chores={chores as any}
        events={events as any}
        rewards={rewardsForKid}
      />
    )
  }

  return (
    <>
      <DashboardHome
        user={user as any}
        chores={chores as any}
        events={events as any}
        stats={stats}
        leaderboard={leaderboard}
        pickups={pickups}
        allowancePending={allowancePending}
        anniversaries={upcomingAnniversaries}
        photoVerifyQueue={photoVerifyQueue}
        budget={budget}
      />
      <AdminControlsWrapper />
    </>
  )
}