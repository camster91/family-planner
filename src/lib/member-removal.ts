/**
 * Remove a member from a household (O-34, docs/decisions/PROVISIONAL_OWNER_DECISIONS.md).
 *
 * A parent detaches another member of their own household. The member keeps
 * their account (they can sign in, join or create another household) but
 * loses everything that tied them to this one:
 *
 * - `family_id` is cleared and `token_version` bumped, so every session they
 *   hold stops working on its next request (the JWT's `tv` no longer matches).
 * - Tablet access: any elevation they hold is ended, their tablet PIN is
 *   deleted, unfinished pairing codes they started are deleted, and every
 *   tablet they paired or confirmed is revoked (a removed co-parent might
 *   have it with them; a parent can pair it again in a minute).
 * - Their unaccepted email invites are cancelled, their connected calendars
 *   (which copy household events out) are disconnected and revoked at the
 *   provider after commit, and their idempotency records (stored response
 *   bodies) and push subscriptions for the household are deleted.
 * - Their notifications and activity rows are deleted: both are read by user
 *   id alone (`GET /api/notifications`, the account export), so keeping them
 *   would let the removed person keep reading household content.
 *
 * Household content stays with the household:
 *
 * - What they created (chores, events, lists, meals, notes, budget rows, ...)
 *   is handed to the removing parent, the same column list account deletion
 *   uses (`HOUSEHOLD_HANDOVER_COLUMNS`), and nullable references to them are
 *   cleared (`HOUSEHOLD_CLEARED_REFERENCES`).
 * - Their open chores, and done chores still waiting for a parent's check
 *   (`completed`), are reassigned to the removing parent, to hand on
 *   (`Chore.assigned_to` is NOT NULL, so a chore cannot be left unassigned);
 *   their open chore occurrences are deleted. Checked chores (`verified`,
 *   `approved`) keep their name as history. Verifying never pays XP or sends
 *   a notification to someone outside the chore's household
 *   (`POST /api/chores/verify`).
 * - They are dropped from every take-turns rotation in the household (O-39,
 *   `dropMemberFromRotationsInTx`): the next turn goes to the person after
 *   them; a rotation left with one person gives every new copy to that person.
 * - Messages they sent stay as written. Rows about them (allowance, sick
 *   days, medication, wishlist, reward requests, habit logs, badges) stay for
 *   the parents, who can delete them.
 *
 * Rules (re-checked under the locks): the actor must still be a parent of the
 * household; the target must be a member of the same household; a parent
 * cannot remove themselves (they delete their account or the household
 * instead); the household must keep at least one parent. Teens and children
 * never reach this (the route answers 403 first).
 *
 * Concurrency: both user locks in id order, then the household lock
 * (src/lib/household-lock.ts order: users first). Two parents removing each
 * other at once serialise; the second finds it is no longer a member.
 */
import { prisma } from '@/lib/prisma'
import { log } from '@/lib/logger'
import { lockHousehold, lockUser } from '@/lib/household-lock'
import { auditSummary, writeAuditLog, type AuditEntry } from '@/lib/household-audit'
import { CLEARED_ELEVATION, revokeDeviceInTransaction } from '@/lib/device-session'
import { writeDeviceAudit } from '@/lib/device-audit'
import { dropMemberFromRotationsInTx } from '@/lib/chore-rotation'
import { canonicalChoreAssigneeInTx } from '@/lib/chore-member-subject'
import { archiveAccountProfilesInTx, HouseholdMemberIdentityConflict } from '@/lib/household-member-lifecycle'
import {
  HOUSEHOLD_CLEARED_REFERENCES,
  HOUSEHOLD_HANDOVER_COLUMNS,
  revokeGrantsAfterCommit,
  takeCalendarConnections,
  type CalendarGrant,
  type DeletionDeps,
} from '@/lib/account-deletion'

export type MemberRemovalCode = 'NOT_A_PARENT' | 'CANNOT_REMOVE_SELF' | 'MEMBER_NOT_FOUND' | 'LAST_PARENT' | 'IDENTITY_CONFLICT'

export class MemberRemovalError extends Error {
  constructor(
    public readonly code: MemberRemovalCode,
    public readonly status: number,
    message: string
  ) {
    super(message)
    this.name = 'MemberRemovalError'
  }
}

export interface MemberRemovalResult {
  removedId: string
  /** Tablets revoked because the removed member paired or confirmed them. */
  tabletsRevoked: number
}

/**
 * Chore and chore-occurrence statuses that count as done. Done chores keep the
 * removed member's name: a `completed` chore still waits for a parent's check,
 * and handing it to the removing parent would give that parent the XP for work
 * the removed member did. Verify skips XP and notifications for an assignee
 * who is no longer in the household, so leaving it assigned is safe.
 */
const FINISHED_STATUSES = ['completed', 'verified', 'approved']

export async function removeHouseholdMember(
  args: { actorId: string; familyId: string; targetId: string },
  deps: Pick<DeletionDeps, 'db' | 'revokeCalendarGrant' | 'now'> = {}
): Promise<MemberRemovalResult> {
  const db = deps.db ?? prisma
  if (!db) throw new Error('Database is not configured')
  const now = deps.now?.() ?? new Date()
  const { actorId, familyId, targetId } = args
  if (actorId === targetId) {
    throw new MemberRemovalError(
      'CANNOT_REMOVE_SELF',
      400,
      'You cannot remove yourself. To leave, delete your account in Settings.'
    )
  }

  const outcome = await db.$transaction(
    async (tx: any) => {
      for (const id of [actorId, targetId].sort()) await lockUser(tx, id)
      await lockHousehold(tx, familyId)

      const [actor, target] = await Promise.all([
        tx.user.findUnique({ where: { id: actorId }, select: { id: true, role: true, family_id: true } }),
        tx.user.findUnique({ where: { id: targetId }, select: { id: true, name: true, role: true, family_id: true } }),
      ])
      if (!actor || actor.family_id !== familyId || actor.role !== 'parent') {
        throw new MemberRemovalError('NOT_A_PARENT', 403, 'Only a parent of this household can remove a member.')
      }
      // Another household's member and a missing id read the same.
      if (!target || target.family_id !== familyId) {
        throw new MemberRemovalError('MEMBER_NOT_FOUND', 404, 'That person is not in your household.')
      }
      if (target.role === 'parent') {
        const parentsLeft = await tx.user.count({ where: { family_id: familyId, role: 'parent', id: { not: target.id } } })
        if (parentsLeft === 0) {
          throw new MemberRemovalError('LAST_PARENT', 409, 'A household needs at least one parent.')
        }
      }

      // Membership and sessions first: nothing issued to them stays live.
      try {
        await archiveAccountProfilesInTx(tx, target.id, familyId, now)
      } catch (error) {
        if (error instanceof HouseholdMemberIdentityConflict) {
          throw new MemberRemovalError('IDENTITY_CONFLICT', 409, error.message)
        }
        throw error
      }
      await tx.user.update({
        where: { id: target.id },
        data: { family_id: null, token_version: { increment: 1 } },
      })

      // Shared tablets.
      await tx.householdDevice.updateMany({
        where: { family_id: familyId, elevated_user_id: target.id },
        data: CLEARED_ELEVATION,
      })
      await tx.parentElevationPin.deleteMany({ where: { user_id: target.id } })
      await tx.devicePairing.deleteMany({ where: { family_id: familyId, created_by: target.id, device_id: null } })
      await tx.devicePairing.updateMany({ where: { family_id: familyId, created_by: target.id }, data: { created_by: actorId } })
      await tx.devicePairing.updateMany({ where: { family_id: familyId, confirmed_by: target.id }, data: { confirmed_by: null } })
      const theirTablets: Array<{ id: string; label: string | null }> = await tx.householdDevice.findMany({
        where: { family_id: familyId, revoked_at: null, OR: [{ created_by: target.id }, { confirmed_by: target.id }] },
        select: { id: true, label: true },
      })
      const revoked: Array<{ id: string; label: string | null }> = []
      for (const tablet of theirTablets) {
        const done = await revokeDeviceInTransaction(tx, {
          deviceId: tablet.id,
          familyId,
          revokedBy: actorId,
          reason: 'parent',
          now,
        })
        if (done) revoked.push(tablet)
      }
      await tx.householdDevice.updateMany({ where: { created_by: target.id }, data: { created_by: null } })
      await tx.householdDevice.updateMany({ where: { confirmed_by: target.id }, data: { confirmed_by: null } })
      await tx.householdDevice.updateMany({ where: { revoked_by: target.id }, data: { revoked_by: null } })

      // Invites, calendars, stored responses, push.
      await tx.familyInvite.deleteMany({ where: { family_id: familyId, created_by: target.id, accepted_at: null } })
      await tx.familyInvite.updateMany({ where: { family_id: familyId, created_by: target.id }, data: { created_by: actorId } })
      const grants: CalendarGrant[] = await takeCalendarConnections(tx, { user_id: target.id, family_id: familyId })
      await tx.calendarOAuthState.deleteMany({ where: { user_id: target.id } })
      await tx.idempotencyRecord.deleteMany({ where: { user_id: target.id } })
      await tx.pushSubscription.deleteMany({ where: { user_id: target.id, family_id: familyId } })

      // Rows read by user id alone.
      await tx.notification.deleteMany({ where: { user_id: target.id } })
      await tx.activity.deleteMany({ where: { user_id: target.id, family_id: familyId } })

      // Chores: open ones go to the removing parent to hand on. Done ones
      // (including those still waiting for a check) keep the removed member's
      // name; verify gives them no XP and sends them nothing.
      await tx.choreAssignment.deleteMany({
        where: { family_id: familyId, assigned_to: target.id, status: { notIn: FINISHED_STATUSES } },
      })
      const openChores = { family_id: familyId, assigned_to: target.id, status: { notIn: FINISHED_STATUSES } }
      const canonicalOpen: Array<{ id: string; assigned_member_id: string | null }> = await tx.chore.findMany({
        where: { ...openChores, assigned_member_id: { not: null } },
        select: { id: true, assigned_member_id: true },
      })
      const canonicalIds = canonicalOpen.filter((row) => row.assigned_member_id).map((row) => row.id)
      if (canonicalIds.length) {
        let assignee
        try {
          assignee = await canonicalChoreAssigneeInTx(tx, familyId, actorId)
        } catch (error) {
          if (error instanceof HouseholdMemberIdentityConflict) throw new MemberRemovalError('IDENTITY_CONFLICT', 409, error.message)
          throw error
        }
        await tx.chore.updateMany({ where: { ...openChores, id: { in: canonicalIds } }, data: assignee })
      }
      await tx.chore.updateMany({
        where: { ...openChores, id: { notIn: canonicalIds } },
        data: { assigned_to: actorId },
      })
      // Take turns (O-39): they leave every rotation in the household; the
      // order carries on with the person after them. Copies already made
      // follow the open-chore rule just above.
      try {
        await dropMemberFromRotationsInTx(tx, familyId, target.id)
      } catch (error) {
        if (error instanceof HouseholdMemberIdentityConflict) throw new MemberRemovalError('IDENTITY_CONFLICT', 409, error.message)
        throw error
      }

      // Household content they created: handed to the removing parent.
      for (const [model, column] of HOUSEHOLD_HANDOVER_COLUMNS) {
        await tx[model].updateMany({ where: { [column]: target.id }, data: { [column]: actorId } })
      }
      for (const [model, column] of HOUSEHOLD_CLEARED_REFERENCES) {
        await tx[model].updateMany({ where: { [column]: target.id }, data: { [column]: null } })
      }
      await tx.upload.updateMany({ where: { family_id: familyId, uploaded_by: target.id }, data: { uploaded_by: null } })

      const base = { familyId, actorUserId: actorId, actorKind: 'person' as const }
      const entries: AuditEntry[] = [
        {
          ...base,
          action: 'member.removed',
          targetType: 'member',
          targetId: target.id,
          summary: auditSummary.memberRemoved(target.name, target.role),
        },
        ...revoked.map(
          (tablet): AuditEntry => ({
            ...base,
            action: 'device.removed',
            targetType: 'device',
            targetId: tablet.id,
            summary: auditSummary.deviceRemoved(tablet.label, 'parent'),
          })
        ),
      ]
      await writeAuditLog(tx, entries)
      return { grants, revoked, role: target.role as string }
    },
    { timeout: 60_000 }
  )

  await revokeGrantsAfterCommit(outcome.grants, deps)
  for (const tablet of outcome.revoked) {
    await writeDeviceAudit(db, {
      familyId,
      deviceId: tablet.id,
      actorUserId: actorId,
      type: 'device.revoked',
      metadata: { reason: 'parent' },
    })
  }
  log.info('member_removal.done', { role: outcome.role, tabletsRevoked: outcome.revoked.length })
  return { removedId: targetId, tabletsRevoked: outcome.revoked.length }
}
