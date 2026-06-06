import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import ChoresContent from './ChoresContent'

export default async function ChoresPage() {
  const sessionUser = await getServerUser()

  if (!sessionUser) {
    return null
  }

  const user = await prisma!.user.findUnique({
    where: { id: sessionUser.id },
    include: { family: true }
  })

  const familyId = user?.family_id || undefined

  // Get all chores for the family
  const chores = familyId ? await prisma!.chore.findMany({
    where: { family_id: familyId },
    include: {
      assignee: { select: { name: true } },
      creator: { select: { name: true } }
    },
    orderBy: { due_date: 'asc' }
  }) : []

  // Compute streak per assignee: count of consecutive days with completed chores in last 7 days
  const streakMap: Record<string, number> = {}
  if (familyId) {
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    sevenDaysAgo.setHours(0, 0, 0, 0)

    const completedChores = await prisma!.chore.findMany({
      where: {
        family_id: familyId,
        status: { in: ['completed', 'verified'] },
        completed_at: { gte: sevenDaysAgo },
      },
      select: { assigned_to: true, completed_at: true, title: true },
      orderBy: { completed_at: 'asc' },
    })

    // Group by assignee
    const byAssignee: Record<string, Date[]> = {}
    for (const c of completedChores) {
      if (!c.completed_at) continue
      if (!byAssignee[c.assigned_to]) byAssignee[c.assigned_to] = []
      byAssignee[c.assigned_to].push(new Date(c.completed_at))
    }

    for (const [assigneeId, dates] of Object.entries(byAssignee)) {
      // Get unique days
      const daySet = new Set<string>()
      for (const d of dates) daySet.add(d.toISOString().split('T')[0])
      const sortedDays = Array.from(daySet).sort()
      // Count consecutive days from today backwards
      let streak = 0
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      for (let i = 0; i < 7; i++) {
        const checkDate = new Date(today)
        checkDate.setDate(today.getDate() - i)
        const dayStr = checkDate.toISOString().split('T')[0]
        if (daySet.has(dayStr)) {
          streak++
        } else {
          break
        }
      }
      streakMap[assigneeId] = streak >= 3 ? streak : 0
    }
  }

  // Get family members for assignment
  const familyMembers = familyId ? await prisma!.user.findMany({
    where: { family_id: familyId },
    select: { id: true, name: true, role: true, age: true },
    orderBy: { role: 'desc' }
  }) : []

  const serializedChores = chores.map((c) => ({
    ...c,
    due_date: c.due_date.toISOString(),
    created_at: c.created_at.toISOString(),
    completed_at: c.completed_at?.toISOString() ?? null,
    verified_at: c.verified_at?.toISOString() ?? null,
    photo_url: c.photo_url ?? null,
    streak: streakMap[c.assigned_to] ?? 0,
  }))

  return (
    <ChoresContent
      chores={serializedChores as any}
      familyMembers={familyMembers as any}
      currentUserId={sessionUser.id}
      userRole={user?.role || 'child'}
    />
  )
}