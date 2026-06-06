import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import DashboardHome from '@/components/dashboard/DashboardHome'
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
    include: { family: true }
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
      prisma!.chore.findMany({ where: choresWhere }),
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
        orderBy: { xp: 'desc' },
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

  const stats = {
    totalChores: chores?.length || 0,
    completedChores: chores?.filter(c => c.status === 'completed' || c.status === 'verified').length || 0,
    pendingChores: chores?.filter(c => c.status === 'pending' || c.status === 'in_progress').length || 0,
    upcomingEvents: events?.length || 0,
    unreadMessages: messages?.length || 0,
  }

  const completionRate = stats.totalChores > 0
    ? Math.round((stats.completedChores / stats.totalChores) * 100)
    : 0

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

  const rewardsForKid = rewards.map(r => ({
    id: r.id,
    name: r.name,
    cost: r.cost,
    description: r.description || undefined,
    status: r.status as 'available' | 'claimed' | 'approved' | 'redeemed',
  }))

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
        completionRate={completionRate}
        leaderboard={leaderboard}
        pickups={pickups}
        allowancePending={allowancePending}
        anniversaries={upcomingAnniversaries}
        photoVerifyQueue={photoVerifyQueue}
      />
      <AdminControlsWrapper />
    </>
  )
}