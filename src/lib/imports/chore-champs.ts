import { z } from 'zod'

const dateValue = z.union([z.string(), z.date()]).transform((value, context) => {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid date' })
    return z.NEVER
  }
  return date
})

export const choreChampsExportSchema = z.object({
  version: z.string().min(1),
  family: z.object({ id: z.string().min(1), name: z.string().min(1) }),
  kids: z.array(z.object({ id: z.string().min(1), name: z.string().min(1) })),
  chores: z.array(z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    description: z.string().nullish(),
    basePoints: z.number().int().nonnegative().default(5),
    difficulty: z.string().default('EASY'),
    recurring: z.string().nullish(),
    isActive: z.boolean().default(true),
    createdAt: dateValue,
  })),
  assignments: z.array(z.object({
    id: z.string().min(1),
    choreId: z.string().min(1),
    kidId: z.string().min(1),
    dueDate: dateValue,
    status: z.string().default('PENDING'),
    completedAt: dateValue.nullish(),
    createdAt: dateValue,
  })),
})

export type ChoreChampsExport = z.input<typeof choreChampsExportSchema>

export interface PlannedChore {
  sourceId: string
  title: string
  description: string | null
  points: number
  difficulty: 'easy' | 'medium' | 'hard'
  frequency: 'once' | 'daily' | 'weekly' | 'monthly'
  active: boolean
  createdAt: Date
}

export interface PlannedAssignment {
  sourceId: string
  sourceChoreId: string
  targetUserId: string
  dueDate: Date
  status: 'pending' | 'in_progress' | 'completed' | 'approved'
  completedAt: Date | null
  createdAt: Date
  idempotencyKey: string
}

export interface ChoreChampsImportPlan {
  sourceVersion: string
  sourceFamilyId: string
  chores: PlannedChore[]
  assignments: PlannedAssignment[]
  skippedAssignments: Array<{ sourceId: string; reason: string }>
}

function normalizeDifficulty(value: string): PlannedChore['difficulty'] {
  switch (value.toUpperCase()) {
    case 'HARD': return 'hard'
    case 'MEDIUM': return 'medium'
    default: return 'easy'
  }
}

function normalizeFrequency(value: string | null | undefined): PlannedChore['frequency'] {
  switch (value?.toUpperCase()) {
    case 'DAILY': return 'daily'
    case 'WEEKLY': return 'weekly'
    case 'MONTHLY': return 'monthly'
    default: return 'once'
  }
}

function normalizeStatus(value: string): PlannedAssignment['status'] {
  switch (value.toUpperCase()) {
    case 'IN_PROGRESS': return 'in_progress'
    case 'COMPLETED': return 'completed'
    case 'APPROVED':
    case 'VERIFIED': return 'approved'
    default: return 'pending'
  }
}

export function planChoreChampsImport(
  input: unknown,
  kidToUserId: Readonly<Record<string, string>>
): ChoreChampsImportPlan {
  const source = choreChampsExportSchema.parse(input)
  const choreIds = new Set(source.chores.map((chore) => chore.id))
  const skippedAssignments: ChoreChampsImportPlan['skippedAssignments'] = []

  const assignments = source.assignments.flatMap<PlannedAssignment>((assignment) => {
    const targetUserId = kidToUserId[assignment.kidId]
    if (!targetUserId) {
      skippedAssignments.push({ sourceId: assignment.id, reason: `No user mapping for kid ${assignment.kidId}` })
      return []
    }
    if (!choreIds.has(assignment.choreId)) {
      skippedAssignments.push({ sourceId: assignment.id, reason: `Missing source chore ${assignment.choreId}` })
      return []
    }
    return [{
      sourceId: assignment.id,
      sourceChoreId: assignment.choreId,
      targetUserId,
      dueDate: assignment.dueDate,
      status: normalizeStatus(assignment.status),
      completedAt: assignment.completedAt ?? null,
      createdAt: assignment.createdAt,
      idempotencyKey: `chore-champs:assignment:${assignment.id}`,
    }]
  })

  return {
    sourceVersion: source.version,
    sourceFamilyId: source.family.id,
    chores: source.chores.map((chore) => ({
      sourceId: chore.id,
      title: chore.title.trim(),
      description: chore.description?.trim() || null,
      points: chore.basePoints,
      difficulty: normalizeDifficulty(chore.difficulty),
      frequency: normalizeFrequency(chore.recurring),
      active: chore.isActive,
      createdAt: chore.createdAt,
    })),
    assignments,
    skippedAssignments,
  }
}

