import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import DashboardHome from '@/components/dashboard/DashboardHome'
import dynamic from 'next/dynamic'

// AdminControls needs client context — load dynamically
const AdminControls = dynamic(() => import('@/components/admin/AdminControls'), {
  ssr: false,
  loading: () => null,
})

export default async function DashboardPage() {
  const sessionUser = await getServerUser()

  if (!sessionUser) {
    return null // Should be handled by layout
  }

  const user = await prisma!.user.findUnique({
    where: { id: sessionUser.id },
    include: { family: true }
  })

  const familyId = user?.family_id || undefined

  // Get chore stats
  const chores = familyId ? await prisma!.chore.findMany({
    where: { family_id: familyId, assigned_to: sessionUser.id }
  }) : []

  // Get upcoming events
  const events = familyId ? await prisma!.event.findMany({
    where: { family_id: familyId, start_time: { gte: new Date() } },
    orderBy: { start_time: 'asc' },
    take: 5
  }) : []

  // Get unread messages
  const messages = familyId ? await prisma!.message.findMany({
    where: {
      family_id: familyId,
      NOT: { read_by: { has: sessionUser.id } }
    },
    take: 10
  }) : []

  // Calculate user points from completed chores
  const completedChores = await prisma!.chore.findMany({
    where: { assigned_to: sessionUser.id, status: 'completed' },
    select: { points: true }
  })

  const userPoints = completedChores?.reduce((total, chore) => total + chore.points, 0) || 0

  // Get rewards to see what can be claimed
  const rewards = familyId ? await prisma!.reward.findMany({
    where: { family_id: familyId, claimed_by: null },
    select: { point_cost: true },
    orderBy: { point_cost: 'asc' }
  }) : []

  const nextReward = rewards?.[0]?.point_cost || 100
  const pointsProgress = Math.min((userPoints / nextReward) * 100, 100)

  const stats = {
    totalChores: chores?.length || 0,
    completedChores: chores?.filter(c => c.status === 'completed' || c.status === 'verified').length || 0,
    pendingChores: chores?.filter(c => c.status === 'pending' || c.status === 'in_progress').length || 0,
    upcomingEvents: events?.length || 0,
    userPoints,
    pointsProgress,
    nextReward,
    unreadMessages: messages?.length || 0,
  }

  const completionRate = stats.totalChores > 0
    ? Math.round((stats.completedChores / stats.totalChores) * 100)
    : 0

  return (
    <>
      <DashboardHome
        user={user as any}
        chores={chores as any}
        events={events as any}
        stats={stats}
        completionRate={completionRate}
      />
      <AdminControls />
    </>
  )
}