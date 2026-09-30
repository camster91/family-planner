import type { Prisma } from '@prisma/client'

/** The chore fields `reopenCompletedChoreInTx` reads. */
export interface ReopenableChore {
  id: string
  family_id: string
}

/**
 * What reopening did: `reopened` (was `completed`, now `pending`), `verified`
 * (a parent checked it, nothing changed) or `open` (already open, a no-op).
 */
export type ReopenOutcome = 'reopened' | 'verified' | 'open'

/**
 * Put a `completed` chore back to `pending`, inside the caller's transaction.
 * Shared by Undo (`POST /api/chores/uncomplete`, #268) and a parent sending a
 * chore back (`POST /api/chores/verify` with `decision: 'reject'`).
 *
 * Only a row that is still `completed` changes. When the conditional update
 * loses (a repeat, or a parent's verify that landed after the caller's own
 * check), the row is re-read so a verified chore is reported as `verified`,
 * never as a false success.
 *
 * Completing a legacy recurring one-off (no series) created the next
 * occurrence and recorded its id in `successor_id`; reopening removes exactly
 * that row while it is still a pending one-off of the household, and clears
 * the field, so completing again does not create a duplicate. Nothing is
 * inferred from title, date or timestamps. Series occurrences are deduplicated
 * by (recurrence_id, due_date) and are left alone.
 */
export async function reopenCompletedChoreInTx(
  tx: Prisma.TransactionClient,
  chore: ReopenableChore,
  extra: Prisma.ChoreUpdateManyMutationInput = {}
): Promise<ReopenOutcome> {
  const before = await tx.chore.findUnique({ where: { id: chore.id }, select: { successor_id: true } })
  const result = await tx.chore.updateMany({
    where: { id: chore.id, status: 'completed' },
    data: { ...extra, status: 'pending', completed_at: null, successor_id: null },
  })
  if (result.count === 0) {
    const current = await tx.chore.findUnique({ where: { id: chore.id }, select: { status: true } })
    return current?.status === 'verified' ? 'verified' : 'open'
  }

  if (before?.successor_id) {
    await tx.chore.deleteMany({
      where: { id: before.successor_id, family_id: chore.family_id, status: 'pending', recurrence_id: null },
    })
  }
  return 'reopened'
}
