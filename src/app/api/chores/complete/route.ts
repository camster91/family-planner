import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { authenticateWithFamily, requireFamilyMatch } from '@/lib/api-auth'
import { notificationServiceServer } from '@/lib/notifications-server'
import { completeChoreSchema } from '@/lib/validations'
import { DIFFICULTY_XP, streakMultiplier, calculateLevel } from '@/lib/gamification'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const body = await request.json()
    const parsed = completeChoreSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const { choreId, photoUrl } = parsed.data

    // Get the chore and verify family ownership
    const chore = await prisma!.chore.findUnique({
      where: { id: choreId },
      include: { assignee: true, creator: true }
    })

    if (!chore) {
      return NextResponse.json({ error: 'Chore not found' }, { status: 404 })
    }

    const familyError = requireFamilyMatch(chore.family_id, auth.user.family_id)
    if (familyError) return familyError

    if (chore.status === 'completed' || chore.status === 'verified') {
      return NextResponse.json({ error: 'Chore already completed' }, { status: 400 })
    }

    // Update chore status
    const updateData: Record<string, unknown> = {
      status: 'completed',
      completed_at: new Date(),
    }

    if (photoUrl) {
      updateData.photo_url = photoUrl
      updateData.photo_verified = false
    }

    await prisma!.chore.update({
      where: { id: choreId },
      data: updateData as any,
    })

    // --- Gamification: Award XP, update streak, check badges ---
    const difficulty = chore.difficulty as keyof typeof DIFFICULTY_XP
    const baseXp = DIFFICULTY_XP[difficulty] || DIFFICULTY_XP.medium
    const user = auth.user

    // Calculate streak
    const today = new Date().toISOString().split('T')[0]
    const lastChoreDate = user.last_chore_date
      ? new Date(user.last_chore_date).toISOString().split('T')[0]
      : null

    let newStreak = user.streak
    if (lastChoreDate === today) {
      // Already did a chore today, streak stays
    } else {
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]
      if (lastChoreDate === yesterday) {
        newStreak = user.streak + 1
      } else {
        newStreak = 1 // Reset streak
      }
    }

    const multiplier = streakMultiplier(newStreak)
    const earnedXp = Math.round(baseXp * multiplier)
    const newXp = user.xp + earnedXp
    const newLevel = calculateLevel(newXp)
    const leveled = newLevel > user.level

    await prisma!.user.update({
      where: { id: auth.user.id },
      data: {
        xp: newXp,
        level: newLevel,
        points: { increment: chore.points },
        streak: newStreak,
        best_streak: Math.max(newStreak, user.best_streak || 0),
        last_chore_date: new Date(),
      },
    })

    // Record activity
    await prisma!.activity.create({
      data: {
        family_id: auth.user.family_id,
        user_id: auth.user.id,
        type: 'chore_completed',
        title: `${auth.user.name} completed "${chore.title}"`,
        description: `Earned ${chore.points} points and ${earnedXp} XP`,
        metadata: JSON.stringify({ points: chore.points, xp: earnedXp, choreId, streak: newStreak }),
      },
    })

    // Check for new badges
    const newBadges: string[] = []
    const completedCount = await prisma!.chore.count({
      where: { assigned_to: auth.user.id, status: { in: ['completed', 'verified'] } },
    })

    const badgeChecks = [
      { id: 'first_chore', condition: completedCount >= 1 },
      { id: 'chore_10', condition: completedCount >= 10 },
      { id: 'chore_50', condition: completedCount >= 50 },
      { id: 'chore_100', condition: completedCount >= 100 },
      { id: 'streak_3', condition: newStreak >= 3 },
      { id: 'streak_7', condition: newStreak >= 7 },
      { id: 'streak_14', condition: newStreak >= 14 },
      { id: 'streak_30', condition: newStreak >= 30 },
      { id: 'points_100', condition: (user.points + chore.points) >= 100 },
      { id: 'points_500', condition: (user.points + chore.points) >= 500 },
      { id: 'points_1000', condition: (user.points + chore.points) >= 1000 },
      { id: 'level_5', condition: newLevel >= 5 },
      { id: 'level_10', condition: newLevel >= 10 },
      { id: 'level_20', condition: newLevel >= 20 },
    ]

    // Time-based badges
    const hour = new Date().getHours()
    if (hour < 8) badgeChecks.push({ id: 'early_bird', condition: true })
    if (hour >= 21) badgeChecks.push({ id: 'night_owl', condition: true })

    // Speed demon: completed same day as created
    const createdDay = new Date(chore.created_at).toISOString().split('T')[0]
    if (createdDay === today) badgeChecks.push({ id: 'speed_demon', condition: true })

    for (const check of badgeChecks) {
      if (check.condition) {
        try {
          await prisma!.userBadge.create({
            data: { user_id: auth.user.id, badge_id: check.id },
          })
          newBadges.push(check.id)
        } catch {
          // Already has badge (unique constraint)
        }
      }
    }

    // Send notifications
    if (chore.assignee && chore.creator) {
      await notificationServiceServer.notifyChoreCompletion(chore, chore.assignee)
    }

    if (leveled) {
      await notificationServiceServer.sendNotification({
        userId: auth.user.id,
        title: `Level Up! You're now Level ${newLevel}!`,
        message: `Keep up the great work! You earned ${earnedXp} XP.`,
        type: 'system',
      })

      await prisma!.activity.create({
        data: {
          family_id: auth.user.family_id,
          user_id: auth.user.id,
          type: 'level_up',
          title: `${auth.user.name} reached Level ${newLevel}!`,
          metadata: JSON.stringify({ level: newLevel }),
        },
      })
    }

    if (newBadges.length > 0) {
      for (const badgeId of newBadges) {
        await prisma!.activity.create({
          data: {
            family_id: auth.user.family_id,
            user_id: auth.user.id,
            type: 'badge_earned',
            title: `${auth.user.name} earned a new badge!`,
            metadata: JSON.stringify({ badgeId }),
          },
        })
      }
    }

    // Handle recurring chores
    if (chore.frequency && chore.frequency !== 'once') {
      await createNextRecurringChore(chore)
    }

    return NextResponse.json({
      success: true,
      choreId,
      gamification: {
        xpEarned: earnedXp,
        totalXp: newXp,
        level: newLevel,
        leveledUp: leveled,
        streak: newStreak,
        multiplier,
        newBadges,
        pointsEarned: chore.points,
      },
    })
  } catch (error) {
    console.error('Error completing chore:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

async function createNextRecurringChore(chore: any) {
  const dueDate = new Date(chore.due_date)
  let nextDueDate: Date

  switch (chore.frequency) {
    case 'daily':
      nextDueDate = new Date(dueDate)
      nextDueDate.setDate(nextDueDate.getDate() + 1)
      break
    case 'weekly':
      nextDueDate = new Date(dueDate)
      nextDueDate.setDate(nextDueDate.getDate() + 7)
      break
    case 'monthly':
      nextDueDate = new Date(dueDate)
      nextDueDate.setMonth(nextDueDate.getMonth() + 1)
      break
    default:
      return
  }

  try {
    await prisma!.chore.create({
      data: {
        family_id: chore.family_id,
        title: chore.title,
        description: chore.description,
        points: chore.points,
        assigned_to: chore.assigned_to,
        due_date: nextDueDate,
        status: 'pending',
        frequency: chore.frequency,
        difficulty: chore.difficulty,
        created_by: chore.created_by,
      },
    })
  } catch (error) {
    console.error('Error creating recurring chore:', error)
  }
}
