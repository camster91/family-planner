/**
 * Take turns: a recurring chore that rotates between chosen members (O-39,
 * docs/decisions/PROVISIONAL_OWNER_DECISIONS.md; docs/product/CHORES.md
 * "Taking turns").
 *
 * Storage (additive, `Chore`):
 * - `rotation_member_ids` on the series template: the members, in order.
 *   Empty means no rotation (every copy goes to the template's assignee, as
 *   before this feature).
 * - `rotation_index` on each row of a rotating series: the place in that list
 *   whose turn the row is (0-based).
 *
 * The rule:
 * - The rotation moves on once per occurrence, in due-date order. A new copy
 *   takes the place after the latest occurrence already in the series. Who
 *   ticked a chore does not matter, and a skipped or late chore keeps its
 *   person (nothing is moved after the fact).
 * - A parent changing who does ONE occurrence (the "Assign to" field) changes
 *   only that row's assignee, never its place, so the order carries on.
 * - Generation is deterministic: the same series state always produces the
 *   same people, so a repeated top-up (or two racing ones, guarded by the
 *   (recurrence_id, due_date) key) never reshuffles copies already made.
 * - A member who is no longer in the household is skipped (the next person in
 *   the list takes the turn). Removing a member also drops them from every
 *   list (`dropMemberFromRotationsInTx`).
 * - Setting or changing the list re-plans the copies due after today that
 *   nobody has started, starting from the first person in the new list. Rows
 *   due today or earlier, and anything started or done, keep their person.
 */
import type { Prisma } from '@prisma/client'
import { canonicalChoreAssigneeInTx } from '@/lib/chore-member-subject'
import { lockHousehold } from '@/lib/household-lock'
import { HouseholdMemberIdentityConflict } from '@/lib/household-member-lifecycle'

// Retain server import compatibility while browser callers use the pure module.
export * from './chore-rotation-shared'
import { sameRotation, planRotationTurns } from './chore-rotation-shared'

/** Every id is a current member of `familyId`. */
export async function rotationMembersInHousehold(
  db: { user: { findMany: (args: any) => Promise<Array<{ id: string }>> } },
  familyId: string,
  rotation: readonly string[]
): Promise<boolean> {
  if (rotation.length === 0) return true
  const found = await db.user.findMany({
    where: { id: { in: [...rotation] }, family_id: familyId },
    select: { id: true },
  })
  const ids = new Set(found.map((u) => u.id))
  return rotation.every((id) => ids.has(id))
}

/**
 * Set (or clear, with an empty list) a series' rotation inside the caller's
 * transaction. No-op when the list is unchanged, so an edit form that posts
 * the list back on every save never reshuffles anything.
 *
 * On a change: every row of the series loses its place, then the rows due
 * after today that are still `pending` get places 0, 1, 2, ... in due-date
 * order and that person. Started or finished rows, and rows a parent gave
 * to someone by hand, keep their person and no place, so they never use up
 * someone's turn and a hand pick is never undone (O-39). The next generated copy carries on from the
 * latest row. Clearing the list leaves every row's person as it is.
 */
export async function applyRotationEditInTx(
  tx: Prisma.TransactionClient,
  templateId: string,
  familyId: string,
  rotation: readonly string[],
  now: Date = new Date()
): Promise<boolean> {
  await lockHousehold(tx, familyId)
  if (!(await rotationMembersInHousehold(tx, familyId, rotation))) throw new HouseholdMemberIdentityConflict()
  const template = await tx.chore.findFirst({
    where: { id: templateId, family_id: familyId },
    select: { id: true, rotation_member_ids: true },
  })
  if (!template) return false
  if (sameRotation(template.rotation_member_ids, rotation)) return false

  // Clearing never reassigns occurrences, so no candidate plan or identity
  // resolution is needed. Keep both effects in the caller's locked transaction.
  if (rotation.length === 0) {
    await tx.chore.update({ where: { id: template.id }, data: { rotation_member_ids: [] } })
    await tx.chore.updateMany({
      where: { family_id: familyId, recurrence_id: template.id },
      data: { rotation_index: null },
    })
    return true
  }

  // Due dates are stored at UTC midnight (src/lib/recurringChores.ts).
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
  // Only copies nobody started take turns. A started or finished copy keeps
  // its person and no place, so it does not use up someone else's turn. A
  // copy a parent gave to someone by hand (its person is not the one its place
  // names) keeps that person too: the new order never undoes a hand pick.
  const oldRotation = template.rotation_member_ids ?? []
  const pending: Array<{ id: string; assigned_to: string | null; assigned_member_id: string | null; rotation_index: number | null }> = []
  let after: { day: Date; id: string } | null = null
  for (;;) {
    const batch = await tx.chore.findMany({
      where: { family_id: familyId, recurrence_id: template.id, due_date: { gte: tomorrow }, status: 'pending',
        ...(after ? { OR: [{ due_date: { gt: after.day } }, { due_date: after.day, id: { gt: after.id } }] } : {}) },
      orderBy: [{ due_date: 'asc' }, { id: 'asc' }], take: 500,
      select: { id: true, assigned_to: true, assigned_member_id: true, rotation_index: true, due_date: true },
    })
    // Keep the complete atomic plan, but do not retain the extra paging dates.
    pending.push(...batch.map(row => ({ id: row.id, assigned_to: row.assigned_to, assigned_member_id: row.assigned_member_id, rotation_index: row.rotation_index })))
    if (batch.length < 500) break
    const last = batch[batch.length - 1]
    if (!Number.isFinite(last.due_date.getTime()) || (after && last.id === after.id && last.due_date.getTime() === after.day.getTime()))
      throw new Error('Rotation candidate cursor did not advance')
    after = { day: last.due_date, id: last.id }
  }
  // In a series that already takes turns, every copy it planned has a place,
  // so a copy without one was set aside (a hand pick from an earlier edit)
  // and stays set aside. Only a series starting to take turns plans them all.
  const future = pending.filter((row) =>
    oldRotation.length === 0
      ? true
      : row.rotation_index != null && oldRotation[row.rotation_index] === row.assigned_to
  )

  const turns = planRotationTurns(rotation, null, future.length)
  // Identity checks are per distinct canonical participant, not per occurrence.
  // The existing household lifecycle lock stays held across preflight/effects.
  // Resolve every required canonical mapping before touching the template/rows.
  const requiredCanonical = new Set<string>()
  for (let index = 0; index < future.length; index++) {
    const assignee = turns[index]?.assignee
    if (future[index].assigned_member_id && assignee) requiredCanonical.add(assignee)
  }
  const canonicalAssignees = new Map<string, { assigned_to: string; assigned_member_id: string }>()
  for (const userId of [...requiredCanonical].sort())
    canonicalAssignees.set(userId, await canonicalChoreAssigneeInTx(tx, familyId, userId))

  await tx.chore.update({ where: { id: template.id }, data: { rotation_member_ids: [...rotation] } })
  await tx.chore.updateMany({
    where: { family_id: familyId, recurrence_id: template.id },
    data: { rotation_index: null },
  })
  for (let i = 0; i < future.length; i++) {
    const turn = turns[i]
    const assignee = turn.assignee
      ? future[i].assigned_member_id
        ? canonicalAssignees.get(turn.assignee)!
        : { assigned_to: turn.assignee }
      : {}
    await tx.chore.update({
      where: { id: future[i].id },
      data: {
        rotation_index: turn.index,
        ...assignee,
      },
    })
  }
  return true
}

/**
 * Drop a member who is leaving the household from every rotation there, in
 * the caller's transaction (member removal, O-34; account deletion).
 *
 * Places are shifted so the order carries on: the removed member's turn
 * passes to the person after them. Rows that pointed at the removed person's
 * place now point at the place before it, so the next copy goes to whoever
 * followed them. A list left with one person stays as that one person (every
 * new copy goes to them, a plain assignment; the forms show it as not taking
 * turns). A list left empty is cleared, and new copies follow the template's
 * assignee as for any series. If the leaving member was the series' own
 * assignee (the template, usually the first person), the series goes to the
 * person who takes their place, so it keeps making copies after they leave.
 * Other chores already made are not touched here: the caller's open-chore
 * rule (O-34: to the removing parent; account deletion: removed) applies.
 */
export async function dropMemberFromRotationsInTx(
  tx: Prisma.TransactionClient,
  familyId: string,
  memberId: string
): Promise<number> {
  const templates = await tx.chore.findMany({
    where: { family_id: familyId, rotation_member_ids: { has: memberId } },
    select: { id: true, rotation_member_ids: true, assigned_to: true, assigned_member_id: true, status: true },
  })
  // Callers hold the household lifecycle lock. Resolve the distinct canonical
  // replacements before this helper changes any rotation; many roots may share
  // one replacement. Keep legacy account-only assignments account-only.
  const plans = templates.map(template => {
    const removedAt = template.rotation_member_ids.indexOf(memberId)
    const rest = template.rotation_member_ids.filter((id) => id !== memberId)
    const retainedHistory = template.assigned_member_id && ['completed', 'verified', 'approved'].includes(template.status)
    const nextAssignee = !retainedHistory && template.assigned_to === memberId && rest.length > 0 ? rest[removedAt % rest.length] : null
    return { template, removedAt, rest, nextAssignee }
  })
  const requiredCanonical = new Set(plans.flatMap(plan =>
    plan.template.assigned_member_id && plan.nextAssignee ? [plan.nextAssignee] : []
  ))
  const canonicalAssignees = new Map<string, { assigned_to: string; assigned_member_id: string }>()
  for (const userId of [...requiredCanonical].sort())
    canonicalAssignees.set(userId, await canonicalChoreAssigneeInTx(tx, familyId, userId))

  for (const { template, removedAt, rest, nextAssignee } of plans) {
    const series = { family_id: familyId, recurrence_id: template.id }
    if (removedAt === 0) {
      await tx.chore.updateMany({ where: { ...series, rotation_index: 0 }, data: { rotation_index: null } })
    } else {
      await tx.chore.updateMany({ where: { ...series, rotation_index: removedAt }, data: { rotation_index: removedAt - 1 } })
    }
    await tx.chore.updateMany({
      where: { ...series, rotation_index: { gt: removedAt } },
      data: { rotation_index: { decrement: 1 } },
    })
    if (rest.length === 0) {
      await tx.chore.updateMany({ where: series, data: { rotation_index: null } })
    }
    const assignee = nextAssignee
      ? template.assigned_member_id
        ? canonicalAssignees.get(nextAssignee)!
        : { assigned_to: nextAssignee }
      : {}
    await tx.chore.update({
      where: { id: template.id },
      data: {
        rotation_member_ids: rest,
        // The series itself goes to the next person, so it is not removed or
        // handed over with the leaving member's own chores.
        ...assignee,
      },
    })
  }
  return templates.length
}
