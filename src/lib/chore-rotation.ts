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

export const ROTATION_MIN = 2
export const ROTATION_MAX = 8

export type RotationTurn = {
  /** Place in the rotation list. */
  index: number
  /** Member whose turn it is, or null when nobody in the list is still in the household. */
  assignee: string | null
}

/**
 * The turn after `previousIndex` (null: the rotation starts at the first
 * person). `isActive` says whether a member is still in the household; a
 * member who is not is skipped. Returns null for an empty rotation.
 */
export function nextRotationTurn(
  rotation: readonly string[],
  previousIndex: number | null | undefined,
  isActive: (memberId: string) => boolean = () => true
): RotationTurn | null {
  const n = rotation.length
  if (n === 0) return null
  const start = previousIndex == null || previousIndex < 0 ? 0 : (previousIndex + 1) % n
  for (let k = 0; k < n; k++) {
    const index = (start + k) % n
    if (isActive(rotation[index])) return { index, assignee: rotation[index] }
  }
  return { index: start, assignee: null }
}

/** `count` turns in a row after `previousIndex`. */
export function planRotationTurns(
  rotation: readonly string[],
  previousIndex: number | null | undefined,
  count: number,
  isActive?: (memberId: string) => boolean
): RotationTurn[] {
  const turns: RotationTurn[] = []
  let prev = previousIndex ?? null
  for (let i = 0; i < count; i++) {
    const turn = nextRotationTurn(rotation, prev, isActive)
    if (!turn) break
    turns.push(turn)
    prev = turn.index
  }
  return turns
}

/** Same members in the same order. */
export function sameRotation(a: readonly string[] | null | undefined, b: readonly string[] | null | undefined): boolean {
  const x = a ?? []
  const y = b ?? []
  return x.length === y.length && x.every((id, i) => id === y[i])
}

/** Whether a stored list means "takes turns" in the forms and lists (two or more people). */
export function isRotating(rotation: readonly string[] | null | undefined): rotation is string[] {
  return Array.isArray(rotation) && rotation.length >= ROTATION_MIN
}

/**
 * Who is up after the occurrence at `index` (for "Takes turns · next: Alex").
 * Null when the row has no place or the list is not a rotation.
 */
export function nextRotationMember(rotation: readonly string[] | null | undefined, index: number | null | undefined): string | null {
  if (!isRotating(rotation) || index == null) return null
  return nextRotationTurn(rotation, index)?.assignee ?? null
}

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
 * order and that person. Started or finished rows keep their person and no
 * place, so they never use up someone's turn. The next generated copy carries on from the
 * latest row. Clearing the list leaves every row's person as it is.
 */
export async function applyRotationEditInTx(
  tx: Prisma.TransactionClient,
  templateId: string,
  familyId: string,
  rotation: readonly string[],
  now: Date = new Date()
): Promise<boolean> {
  const template = await tx.chore.findFirst({
    where: { id: templateId, family_id: familyId },
    select: { id: true, rotation_member_ids: true },
  })
  if (!template) return false
  if (sameRotation(template.rotation_member_ids, rotation)) return false

  await tx.chore.update({ where: { id: template.id }, data: { rotation_member_ids: [...rotation] } })
  await tx.chore.updateMany({
    where: { family_id: familyId, recurrence_id: template.id },
    data: { rotation_index: null },
  })
  if (rotation.length === 0) return true

  // Due dates are stored at UTC midnight (src/lib/recurringChores.ts).
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
  // Only copies nobody started take turns. A started or finished copy keeps
  // its person and no place, so it does not use up someone else's turn.
  const future = await tx.chore.findMany({
    where: { family_id: familyId, recurrence_id: template.id, due_date: { gte: tomorrow }, status: 'pending' },
    orderBy: [{ due_date: 'asc' }, { id: 'asc' }],
    select: { id: true },
  })
  const turns = planRotationTurns(rotation, null, future.length)
  for (let i = 0; i < future.length; i++) {
    const turn = turns[i]
    await tx.chore.update({
      where: { id: future[i].id },
      data: {
        rotation_index: turn.index,
        ...(turn.assignee ? { assigned_to: turn.assignee } : {}),
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
    select: { id: true, rotation_member_ids: true, assigned_to: true },
  })
  for (const template of templates) {
    const removedAt = template.rotation_member_ids.indexOf(memberId)
    const rest = template.rotation_member_ids.filter((id) => id !== memberId)
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
    await tx.chore.update({
      where: { id: template.id },
      data: {
        rotation_member_ids: rest,
        // The series itself goes to the next person, so it is not removed or
        // handed over with the leaving member's own chores.
        ...(template.assigned_to === memberId && rest.length > 0 ? { assigned_to: rest[removedAt % rest.length] } : {}),
      },
    })
  }
  return templates.length
}
