import { prisma } from '@/lib/prisma'
import type { ChoreFrequency } from '@/types'

const FREQUENCY_CONFIG: Record<Exclude<ChoreFrequency, 'once'>, { occurrences: number; unit: 'day' | 'week' | 'month'; amount: number }> = {
  daily: { occurrences: 7, unit: 'day', amount: 1 },
  weekly: { occurrences: 4, unit: 'day', amount: 7 },
  monthly: { occurrences: 3, unit: 'day', amount: 30 },
}

/**
 * Given a recurring chore, generate and insert future occurrences
 * into the DB with status='pending' and due_date offsets.
 * Called on POST /api/chores/create and on the cron endpoint.
 */
export async function expandRecurringChores(
  chore: { id: string; frequency: string; assigned_to: string; created_by: string },
  familyId: string
): Promise<number> {
  if (chore.frequency === 'once') return 0

  const config = FREQUENCY_CONFIG[chore.frequency as Exclude<ChoreFrequency, 'once'>]
  if (!config) return 0

  // Fetch the original chore to copy all fields except due_date/id/status
  const originalChore = await prisma!.chore.findUnique({
    where: { id: chore.id },
    select: {
      title: true,
      description: true,
      points: true,
      difficulty: true,
      frequency: true,
      family_id: true,
      assigned_to: true,
      created_by: true,
    },
  })

  if (!originalChore) return 0

  const now = new Date()
  // Create occurrences starting from the original due_date + offset
  const occurrences: Array<{
    family_id: string
    title: string
    description: string | null
    points: number
    difficulty: string
    frequency: string
    assigned_to: string
    created_by: string
    due_date: Date
    status: string
  }> = []

  for (let i = 1; i <= config.occurrences; i++) {
    const dueDate = new Date(now)
    dueDate.setDate(dueDate.getDate() + config.amount * i)
    dueDate.setHours(0, 0, 0, 0)

    occurrences.push({
      family_id: familyId,
      title: originalChore.title,
      description: originalChore.description,
      points: originalChore.points,
      difficulty: originalChore.difficulty,
      frequency: originalChore.frequency,
      assigned_to: originalChore.assigned_to,
      created_by: originalChore.created_by,
      due_date: dueDate,
      status: 'pending',
    })
  }

  if (occurrences.length === 0) return 0

  await prisma!.chore.createMany({ data: occurrences })
  return occurrences.length
}

/**
 * Expand all recurring chores for a family that are due today or overdue.
 * Used by the daily cron to regenerate occurrences that have passed.
 */
export async function expandAllRecurringChores(familyId: string): Promise<number> {
  const now = new Date()
  now.setHours(0, 0, 0, 0)

  // Find all pending recurring chores (non-'once') for this family
  const recurringChores = await prisma!.chore.findMany({
    where: {
      family_id: familyId,
      frequency: { not: 'once' },
      status: { in: ['pending', 'completed', 'verified'] },
    },
    select: { id: true, frequency: true, assigned_to: true, created_by: true },
  })

  let totalInserted = 0
  for (const chore of recurringChores) {
    const inserted = await expandRecurringChores(chore, familyId)
    totalInserted += inserted
  }

  return totalInserted
}