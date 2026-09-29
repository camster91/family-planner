/**
 * Account and household deletion (D-3; contract: docs/product/ACCOUNT_DELETION.md).
 *
 * Two operations, each an explicit, ordered sequence rather than a single
 * `DELETE` that leans on whatever the foreign keys happen to cascade:
 *
 * - `deleteMemberAccount`: one member leaves for good. Household content they
 *   created (chores, events, lists, meals, notes, recipes, budget rows, ...)
 *   is handed to a successor parent so the household keeps it; their personal
 *   rows (notifications, messages they sent, their own chores, badges,
 *   medical and allowance rows about them, calendar connection, PIN,
 *   idempotency records) are deleted; references to them elsewhere are
 *   cleared. The only parent of a household cannot use it (LAST_PARENT).
 * - `deleteHousehold`: the only parent deletes the household and every member
 *   account in it. Refused while another parent exists (OTHER_PARENTS_EXIST).
 *
 * Both run their database work in one transaction, re-checking the rules
 * inside it under the per-household membership lock (src/lib/household-lock.ts,
 * also taken by every join path), so a concurrent change (a member joining, a
 * duplicate request) cannot slip between the check and the delete. Two things
 * cannot be transactional and both run after commit, so a failed transaction
 * changes nothing: provider-side calendar revocation (best effort; the stored
 * tokens, links and imported events are deleted inside the transaction) and
 * removal of uploaded files from disk (a failure is counted and logged, the
 * rows that made the files reachable are already gone).
 *
 * Retries converge: the functions are safe to run again, and after a
 * successful run the member no longer exists, so a replayed request fails
 * authentication (401) instead of deleting anything else.
 */
import path from 'path'
import { unlink } from 'fs/promises'
import { prisma } from '@/lib/prisma'
import { log } from '@/lib/logger'
import { chorePhotoFilename, CHORE_PHOTO_FILENAME_RE } from '@/lib/chore-photos'
import { clearConnectionData, revokeProviderGrant } from '@/lib/calendar-sync/sync'
import { lockHousehold, lockUser } from '@/lib/household-lock'
import { auditSummary, roleWord, writeAuditLog } from '@/lib/household-audit'
import type { AccountDeletionCode, DeletionOptions } from '@/lib/account-deletion-shared'

export class AccountDeletionError extends Error {
  constructor(
    public readonly code: AccountDeletionCode,
    public readonly status: number,
    message: string
  ) {
    super(message)
    this.name = 'AccountDeletionError'
  }
}

const LAST_PARENT_MESSAGE =
  'You are the only parent in this household. Add another parent first, or delete the whole household.'

export interface DeletionDeps {
  /** Prisma client (tests pass a fake). */
  db?: any
  /** Upload root; defaults to UPLOAD_DIR like /api/upload. */
  uploadDir?: string
  /** File removal; defaults to fs.unlink. A missing file counts as removed. */
  removeFile?: (absolutePath: string) => Promise<void>
  /**
   * Provider-side revoke of one calendar grant, run after commit; defaults to
   * calendar-sync `revokeProviderGrant` (no database writes).
   */
  revokeCalendarGrant?: (grant: CalendarGrant, familyId: string) => Promise<unknown>
  now?: () => Date
}

export interface FileCleanup {
  filesRemoved: number
  filesNotRemoved: number
}

export interface MemberDeletionResult extends FileCleanup {
  mode: 'account'
  /** False when the account was already gone (a converged retry). */
  deleted: boolean
  successorId: string | null
}

export interface HouseholdDeletionResult extends FileCleanup {
  mode: 'household'
  deleted: boolean
  membersRemoved: number
}

function dbOf(deps: DeletionDeps): any {
  const db = deps.db ?? prisma
  if (!db) throw new Error('Database is not configured')
  return db
}

function uploadRoot(deps: DeletionDeps): string {
  return deps.uploadDir ?? process.env.UPLOAD_DIR ?? '/data/family-planner-uploads'
}

async function defaultRemoveFile(absolutePath: string): Promise<void> {
  try {
    await unlink(absolutePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return
    throw error
  }
}


// ---------------------------------------------------------------------------
// Options (read-only)

export async function getDeletionOptions(userId: string, deps: DeletionDeps = {}): Promise<DeletionOptions | null> {
  const db = dbOf(deps)
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, role: true, family_id: true } })
  if (!user) return null
  if (!user.family_id) {
    return { role: user.role, household: null, isOnlyParent: false, canDeleteAccount: true, canDeleteHousehold: false }
  }
  const [family, members] = await Promise.all([
    db.family.findUnique({ where: { id: user.family_id }, select: { name: true } }),
    db.user.findMany({ where: { family_id: user.family_id }, select: { id: true, role: true } }),
  ])
  const parentCount = members.filter((m: { role: string }) => m.role === 'parent').length
  const others = members.filter((m: { id: string }) => m.id !== user.id)
  const otherParents = others.filter((m: { role: string }) => m.role === 'parent').length
  const isParent = user.role === 'parent'
  const isOnlyParent = isParent && otherParents === 0
  return {
    role: user.role,
    household: { id: user.family_id, name: family?.name ?? '', memberCount: members.length, parentCount },
    isOnlyParent,
    canDeleteAccount: isParent ? otherParents > 0 : others.length > 0,
    canDeleteHousehold: isOnlyParent,
  }
}

// ---------------------------------------------------------------------------
// Files

interface FileTarget {
  /** Absolute path under the upload root. */
  path: string
}

/** Resolve a stored name under the upload root, refusing anything that escapes it. */
function resolveUnder(root: string, ...parts: string[]): string | null {
  const base = path.resolve(root)
  const full = path.resolve(base, ...parts)
  return full.startsWith(base + path.sep) ? full : null
}

/**
 * Files a chore/assignment `photo_url` may point at: the canonical
 * `/api/files/chores/<f>` (UPLOAD_DIR/chores), the legacy `/api/files/<f>`
 * (UPLOAD_DIR root) and a bare `<f>`, which both serving routes accept.
 */
function legacyPhotoPaths(root: string, photoUrl: string): string[] {
  const out: string[] = []
  const chores = chorePhotoFilename(photoUrl)
  if (chores) {
    const p = resolveUnder(root, 'chores', chores)
    if (p) out.push(p)
  }
  const legacyPrefix = '/api/files/'
  const rootName = photoUrl.startsWith(legacyPrefix) ? photoUrl.slice(legacyPrefix.length) : photoUrl
  if (CHORE_PHOTO_FILENAME_RE.test(rootName)) {
    const p = resolveUnder(root, rootName)
    if (p) out.push(p)
  }
  return out
}

async function removeFiles(targets: FileTarget[], deps: DeletionDeps): Promise<FileCleanup> {
  const remove = deps.removeFile ?? defaultRemoveFile
  let filesRemoved = 0
  let filesNotRemoved = 0
  for (const target of [...new Set(targets.map((t) => t.path))]) {
    try {
      await remove(target)
      filesRemoved += 1
    } catch (error) {
      filesNotRemoved += 1
      log.error('account_deletion.file_remove_failed', error instanceof Error ? error : undefined, {
        file: path.basename(target),
      })
    }
  }
  return { filesRemoved, filesNotRemoved }
}

/** The filename a chore/assignment `photo_url` names, in any accepted form. */
function photoRefName(url: string): string {
  return chorePhotoFilename(url) ?? url.replace(/^\/api\/files\//, '')
}

/**
 * Every `photo_url` spelling that points at the same file: the canonical
 * `/api/files/chores/<f>`, the legacy `/api/files/<f>` and a bare `<f>`, which
 * the serving routes all accept.
 */
function photoRefAliases(name: string): string[] {
  return [`/api/files/chores/${name}`, `/api/files/${name}`, name]
}

/**
 * Photo filenames that another household also references. Legacy files
 * (before Upload rows) are content-addressed without a household namespace, so
 * the same image can be shared, and each household may spell the reference
 * differently; compare by filename across every accepted form. Such a file is
 * left in place.
 */
async function photoNamesUsedElsewhere(tx: any, familyId: string, names: string[]): Promise<Set<string>> {
  if (names.length === 0) return new Set()
  const refs = [...new Set(names.flatMap(photoRefAliases))]
  const [chores, assignments] = await Promise.all([
    tx.chore.findMany({ where: { photo_url: { in: refs }, family_id: { not: familyId } }, select: { photo_url: true } }),
    tx.choreAssignment.findMany({
      where: { photo_url: { in: refs }, family_id: { not: familyId } },
      select: { photo_url: true },
    }),
  ])
  return new Set([...chores, ...assignments].map((r: { photo_url: string }) => photoRefName(r.photo_url)))
}

// ---------------------------------------------------------------------------
// Member account

/**
 * Delete one member's account (not the household). See the file comment for
 * what is kept, handed over and deleted.
 */
export async function deleteMemberAccount(userId: string, deps: DeletionDeps = {}): Promise<MemberDeletionResult> {
  const db = dbOf(deps)
  const root = uploadRoot(deps)

  const pre = await db.user.findUnique({ where: { id: userId }, select: { id: true, role: true, family_id: true } })
  if (!pre) return { mode: 'account', deleted: false, successorId: null, filesRemoved: 0, filesNotRemoved: 0 }
  if (pre.family_id) await assertMemberMayLeave(db, pre)

  const outcome = await db.$transaction(
    async (tx: any) => {
      const none = { deleted: false, successorId: null, files: [] as FileTarget[], grants: [] as CalendarGrant[] }
      // User lock first (order: user, then household; src/lib/household-lock.ts).
      // Under it no create/join can attach this account to a household.
      await lockUser(tx, userId)
      const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, role: true, family_id: true } })
      if (!user) return none

      if (!user.family_id) {
        const grants = await takeCalendarConnections(tx, { user_id: user.id })
        await deletePersonalRows(tx, user.id)
        await tx.user.delete({ where: { id: user.id } })
        return { deleted: true, successorId: null, files: [] as FileTarget[], grants }
      }

      const familyId: string = user.family_id
      await lockHousehold(tx, familyId)
      // A household deletion (household lock only) may have removed this
      // account while we waited: read it again under both locks.
      const still = await tx.user.findUnique({ where: { id: userId }, select: { family_id: true } })
      if (!still || still.family_id !== familyId) return none
      const successorId = await assertMemberMayLeave(tx, user)
      // Their calendar connections: encrypted grants kept for the revoke
      // after commit; links, imported events and rows deleted here.
      const grants = await takeCalendarConnections(tx, { user_id: user.id })
      const files = await handOverAndDetach(tx, user.id, familyId, successorId, root)
      await recordMemberLeft(tx, user, familyId)
      await deletePersonalRows(tx, user.id)
      await tx.user.delete({ where: { id: user.id } })
      return { deleted: true, successorId, files, grants }
    },
    { timeout: 60_000 }
  )

  await revokeGrantsAfterCommit(outcome.grants, deps)
  const cleanup = await removeFiles(outcome.files, deps)
  if (outcome.deleted) {
    log.info('account_deletion.member', { role: pre.role, hadHousehold: Boolean(pre.family_id), ...cleanup })
  }
  return { mode: 'account', deleted: outcome.deleted, successorId: outcome.successorId, ...cleanup }
}

/**
 * The rules for a member leaving a household. Returns the successor who takes
 * over the household content they created: the earliest other parent, or for
 * a teen/child with no parent left, the earliest other member.
 */
async function assertMemberMayLeave(
  db: any,
  user: { id: string; role: string; family_id: string | null }
): Promise<string> {
  const parent = await db.user.findFirst({
    where: { family_id: user.family_id, role: 'parent', id: { not: user.id } },
    select: { id: true },
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
  })
  if (parent) return parent.id
  if (user.role === 'parent') throw new AccountDeletionError('LAST_PARENT', 409, LAST_PARENT_MESSAGE)
  const other = await db.user.findFirst({
    where: { family_id: user.family_id, id: { not: user.id } },
    select: { id: true },
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
  })
  if (other) return other.id
  throw new AccountDeletionError(
    'NO_SUCCESSOR',
    409,
    'You are the last member of this household. Ask a parent to delete the household instead.'
  )
}

/** What is needed to revoke one calendar grant at the provider after commit. */
export interface CalendarGrant {
  id: string
  family_id: string
  provider: string
  access_token_enc: string | null
  refresh_token_enc: string | null
}

/**
 * Inside the deletion transaction: read the connections matching `where`
 * (with their encrypted tokens, kept in memory for the revoke after commit),
 * then delete each one's links, the events imported through it, and the row.
 * Nothing about a connection changes unless the whole deletion commits.
 */
async function takeCalendarConnections(tx: any, where: Record<string, unknown>): Promise<CalendarGrant[]> {
  // Row-lock the connections before reading their tokens. A sync that is
  // refreshing a token at the same moment then waits to write the rotated
  // token until this transaction commits, finds no row, and revokes the new
  // token itself (src/lib/calendar-sync/sync.ts accessToken). Reading after
  // the lock also picks up any token written just before it.
  const ids: string[] = (await tx.calendarConnection.findMany({ where, select: { id: true } })).map(
    (c: { id: string }) => c.id
  )
  if (ids.length === 0) return []
  await tx.$queryRaw`SELECT id FROM "CalendarConnection" WHERE id = ANY(${ids}::text[]) FOR UPDATE`
  const grants: CalendarGrant[] = await tx.calendarConnection.findMany({
    where: { id: { in: ids } },
    select: { id: true, family_id: true, provider: true, access_token_enc: true, refresh_token_enc: true },
  })
  for (const grant of grants) {
    await clearConnectionData(tx, grant.id, grant.family_id)
    await tx.calendarConnection.deleteMany({ where: { id: grant.id, family_id: grant.family_id } })
  }
  return grants
}

/**
 * After commit: revoke each grant at the provider, best effort.
 *
 * Why after, not before: a revoke cannot be undone. Revoking first and then
 * failing the transaction would leave the household with calendar rows whose
 * grant is dead. Revoking after commit only ever affects data that is already
 * deleted; if the provider is unreachable the grant can outlive the account at
 * the provider (the stored tokens are gone either way), which is the retention
 * exception documented in ACCOUNT_DELETION.md.
 */
async function revokeGrantsAfterCommit(grants: CalendarGrant[], deps: DeletionDeps): Promise<void> {
  const revoke =
    deps.revokeCalendarGrant ?? ((grant: CalendarGrant, familyId: string) => revokeProviderGrant(grant, familyId))
  for (const grant of grants) {
    try {
      await revoke(grant, grant.family_id)
    } catch (error) {
      log.warn('account_deletion.calendar_revoke_failed', {
        connectionId: grant.id,
        error: error instanceof Error ? error.message : 'unknown',
      })
    }
  }
}

/**
 * Member path, inside the transaction: hand household content to the
 * successor, clear references, delete what was only about this member.
 * Returns the files to remove after commit.
 */
async function handOverAndDetach(
  tx: any,
  userId: string,
  familyId: string,
  successorId: string,
  root: string
): Promise<FileTarget[]> {
  const to = successorId
  const inFamily = { family_id: familyId }

  // Sessions and credentials first: nothing issued to this member stays live.
  await tx.user.update({
    where: { id: userId },
    data: {
      token_version: { increment: 1 },
      reset_token: null,
      reset_token_expires: null,
      verify_token: null,
      verify_token_expires: null,
    },
  })
  await tx.householdDevice.updateMany({
    where: { ...inFamily, elevated_user_id: userId },
    data: {
      elevation_token_hash: null,
      elevated_user_id: null,
      elevated_token_version: null,
      elevation_method: null,
      elevation_started_at: null,
      elevation_last_used_at: null,
      elevation_expires_at: null,
    },
  })
  await tx.parentElevationPin.deleteMany({ where: { user_id: userId } })
  // Pairing codes this member started and that were not finished.
  await tx.devicePairing.deleteMany({ where: { created_by: userId, device_id: null } })
  await tx.devicePairing.updateMany({ where: { created_by: userId }, data: { created_by: to } })
  await tx.devicePairing.updateMany({ where: { confirmed_by: userId }, data: { confirmed_by: null } })
  await tx.householdDevice.updateMany({ where: { created_by: userId }, data: { created_by: null } })
  await tx.householdDevice.updateMany({ where: { confirmed_by: userId }, data: { confirmed_by: null } })
  await tx.householdDevice.updateMany({ where: { revoked_by: userId }, data: { revoked_by: null } })
  await tx.familyInvite.deleteMany({ where: { created_by: userId, accepted_at: null } })
  await tx.familyInvite.updateMany({ where: { created_by: userId }, data: { created_by: to } })
  await tx.calendarOAuthState.deleteMany({ where: { user_id: userId } })
  await tx.calendarConnection.deleteMany({ where: { user_id: userId } })
  await tx.idempotencyRecord.deleteMany({ where: { user_id: userId } })

  // Their own chores (assigned to them) go; photos are handled below.
  const ownChores = await tx.chore.findMany({ where: { ...inFamily, assigned_to: userId }, select: { id: true } })
  const ownChoreIds = ownChores.map((c: { id: string }) => c.id)
  const [ownAssignments, habitLogs, badges, redemptions, wishes] = await Promise.all([
    tx.choreAssignment.findMany({
      where: { OR: [{ assigned_to: userId }, { chore_id: { in: ownChoreIds } }] },
      select: { id: true },
    }),
    tx.habitLog.findMany({ where: { user_id: userId }, select: { id: true } }),
    tx.earnedBadge.findMany({ where: { user_id: userId }, select: { id: true } }),
    tx.rewardRedemption.findMany({ where: { requested_by: userId }, select: { id: true } }),
    tx.wishlistItem.findMany({ where: { requested_by: userId }, select: { id: true } }),
  ])
  const removedTargets = [...ownChores, ...ownAssignments, ...habitLogs, ...badges, ...redemptions, ...wishes].map(
    (r: { id: string }) => r.id
  )
  if (removedTargets.length > 0) {
    // Import provenance for rows that no longer exist.
    await tx.importedRecord.deleteMany({ where: { ...inFamily, target_id: { in: removedTargets } } })
  }

  // Household content: hand over to the successor (NOT NULL creator columns,
  // several of them RESTRICT/NO ACTION in the database).
  const handOver: Array<[string, string]> = [
    ['chore', 'created_by'],
    ['event', 'created_by'],
    ['list', 'created_by'],
    ['listItem', 'added_by'],
    ['reward', 'created_by'],
    ['transaction', 'user_id'],
    ['budgetCategory', 'created_by'],
    ['project', 'created_by'],
    ['familyMeal', 'created_by'],
    ['pinnedNote', 'created_by'],
    ['familyLocation', 'user_id'],
    ['pickup', 'created_by'],
    ['allowance', 'from_user_id'],
    ['handoff', 'created_by'],
    ['sickDay', 'created_by'],
    ['medication', 'created_by'],
    ['calendarSubscription', 'created_by'],
    ['importJob', 'started_by'],
    ['recipe', 'created_by'],
    ['mealPlan', 'created_by'],
    ['shoppingList', 'created_by'],
    ['habit', 'created_by'],
    ['familyGoal', 'created_by'],
  ]
  // Nullable references: cleared.
  const clear: Array<[string, string]> = [
    ['listItem', 'checked_by'],
    ['reward', 'claimed_by'],
    ['reward', 'approved_by'],
    ['projectTask', 'assigned_to'],
    ['familyMeal', 'cook_id'],
    ['anniversary', 'person_id'],
    ['anniversary', 'created_by'],
    ['emergencyContact', 'person_id'],
    ['pickup', 'assigned_to'],
    ['wishlistItem', 'status_changed_by'],
    ['choreAssignment', 'completed_by'],
    ['choreAssignment', 'approved_by'],
    ['rewardRedemption', 'approved_by'],
    ['inventoryItem', 'added_by'],
    ['inventoryAdjustment', 'actor_id'],
    ['inventoryAdjustment', 'undone_by'],
    ['grocerySectionPreference', 'updated_by'],
    ['deviceAuditEvent', 'actor_user_id'],
    ['auditLog', 'actor_user_id'],
  ]

  // Delete what was only about this member before handing anything over, so
  // a chore they both created and were assigned is deleted, not handed over.
  await tx.choreAssignment.deleteMany({ where: { id: { in: ownAssignments.map((a: { id: string }) => a.id) } } })
  await tx.chore.deleteMany({ where: { id: { in: ownChoreIds } } })
  await tx.allowance.deleteMany({ where: { to_user_id: userId } })
  await tx.medication.deleteMany({ where: { person_id: userId } })
  await tx.sickDay.deleteMany({ where: { person_id: userId } })
  await tx.wishlistItem.deleteMany({ where: { requested_by: userId } })
  await tx.rewardRedemption.deleteMany({ where: { requested_by: userId } })

  for (const [model, column] of handOver) {
    await tx[model].updateMany({ where: { [column]: userId }, data: { [column]: to } })
  }
  for (const [model, column] of clear) {
    await tx[model].updateMany({ where: { [column]: userId }, data: { [column]: null } })
  }
  await tx.$executeRaw`
    UPDATE "Message" SET "read_by" = array_remove("read_by", ${userId})
    WHERE "family_id" = ${familyId} AND ${userId} = ANY("read_by")
  `

  // Photos this member uploaded stay with the household (uploader cleared
  // below) and go with the household when it is deleted. They are not
  // removed here even when nothing seems to use them: attaching a photo to a
  // chore, an assignment or the calm display is a separate write that does
  // not take the household lock and has no foreign key to Upload, so "unused"
  // cannot be decided atomically, and removing a photo another member is
  // attaching at that moment would break their chore. Retention exception in
  // docs/product/ACCOUNT_DELETION.md.
  const files: FileTarget[] = []
  await tx.upload.updateMany({ where: { uploaded_by: userId }, data: { uploaded_by: null } })
  return files
}

/**
 * Household audit history (#285, ADR-0008), in the deletion transaction: the
 * household keeps a line saying a member left, with their role word only, and
 * the name is taken out of the line recording when they joined. Their actor
 * references are cleared with the other nullable references above.
 */
async function recordMemberLeft(tx: any, user: { id: string; role: string }, familyId: string): Promise<void> {
  await tx.auditLog.updateMany({
    where: { family_id: familyId, action: 'member.joined', target_type: 'member', target_id: user.id },
    data: { summary: auditSummary.memberJoined(null, user.role), target_id: null },
  })
  await writeAuditLog(tx, {
    familyId,
    actorUserId: null,
    actorKind: 'person',
    action: 'member.left',
    targetType: 'member',
    targetId: null,
    summary: auditSummary.memberLeft(user.role),
  })
}

/** Rows that belong to the person alone (any household). */
async function deletePersonalRows(tx: any, userId: string): Promise<void> {
  await tx.notification.deleteMany({ where: { user_id: userId } })
  await tx.pushSubscription.deleteMany({ where: { user_id: userId } })
  await tx.activity.deleteMany({ where: { user_id: userId } })
  await tx.message.deleteMany({ where: { sender_id: userId } })
  await tx.habitLog.deleteMany({ where: { user_id: userId } })
  await tx.earnedBadge.deleteMany({ where: { user_id: userId } })
  await tx.calendarOAuthState.deleteMany({ where: { user_id: userId } })
  await tx.calendarConnection.deleteMany({ where: { user_id: userId } })
  await tx.parentElevationPin.deleteMany({ where: { user_id: userId } })
  await tx.idempotencyRecord.deleteMany({ where: { user_id: userId } })
}

// ---------------------------------------------------------------------------
// Whole household

/**
 * Every household-scoped model, in deletion order (children before parents).
 * `scope` says how rows of this household are found. Kept in step with
 * prisma/schema.prisma by src/lib/__tests__/account-deletion.test.ts, which
 * fails when a model is neither listed here nor in NOT_HOUSEHOLD_SCOPED.
 */
type Scope =
  | { kind: 'family' }
  | { kind: 'members'; column: string }
  | { kind: 'parent'; relation: string }
  | { kind: 'familyOrMembers'; column: string }

export const HOUSEHOLD_DELETION_PLAN: ReadonlyArray<{ model: string; scope: Scope; why: string }> = [
  // 1. Shared devices: sessions (access + refresh tokens), pairings, devices.
  { model: 'deviceSession', scope: { kind: 'family' }, why: 'device access and refresh tokens' },
  { model: 'devicePairing', scope: { kind: 'family' }, why: 'pending pairing codes' },
  { model: 'deviceAuditEvent', scope: { kind: 'family' }, why: 'device audit history' },
  { model: 'auditLog', scope: { kind: 'family' }, why: 'household audit history (#285)' },
  { model: 'householdDevice', scope: { kind: 'family' }, why: 'paired tablets (and any elevation)' },
  { model: 'parentElevationPin', scope: { kind: 'familyOrMembers', column: 'user_id' }, why: 'tablet PINs' },
  // 2. Tokens and links that could still reach the household.
  { model: 'familyInvite', scope: { kind: 'family' }, why: 'pending invitations' },
  { model: 'calendarOAuthState', scope: { kind: 'familyOrMembers', column: 'user_id' }, why: 'OAuth states' },
  { model: 'idempotencyRecord', scope: { kind: 'familyOrMembers', column: 'user_id' }, why: 'stored responses' },
  { model: 'pushSubscription', scope: { kind: 'familyOrMembers', column: 'user_id' }, why: 'push endpoints' },
  { model: 'handoff', scope: { kind: 'family' }, why: 'sitter share links' },
  // 3. Calendar integrations (connections already cleared one by one above; listed so none is missed).
  { model: 'calendarEventLink', scope: { kind: 'family' }, why: 'provider event links' },
  { model: 'event', scope: { kind: 'family' }, why: 'events' },
  { model: 'calendarConnection', scope: { kind: 'family' }, why: 'provider tokens' },
  { model: 'calendarSubscription', scope: { kind: 'family' }, why: 'ICS feed URLs' },
  // 4. Household content.
  { model: 'inventoryAdjustment', scope: { kind: 'family' }, why: 'inventory history' },
  { model: 'inventoryItem', scope: { kind: 'family' }, why: 'inventory' },
  { model: 'groceryShoppingSession', scope: { kind: 'family' }, why: 'shopping trips' },
  { model: 'grocerySectionPreference', scope: { kind: 'family' }, why: 'store sections' },
  { model: 'transaction', scope: { kind: 'family' }, why: 'budget transactions' },
  { model: 'listItem', scope: { kind: 'parent', relation: 'list' }, why: 'list items' },
  { model: 'list', scope: { kind: 'family' }, why: 'lists' },
  { model: 'budgetCategory', scope: { kind: 'family' }, why: 'budget categories' },
  { model: 'projectTask', scope: { kind: 'parent', relation: 'project' }, why: 'project tasks' },
  { model: 'project', scope: { kind: 'family' }, why: 'projects' },
  { model: 'choreAssignment', scope: { kind: 'family' }, why: 'chore assignments' },
  { model: 'chore', scope: { kind: 'family' }, why: 'chores' },
  { model: 'habitLog', scope: { kind: 'family' }, why: 'habit logs' },
  { model: 'habit', scope: { kind: 'family' }, why: 'habits' },
  { model: 'earnedBadge', scope: { kind: 'family' }, why: 'badges' },
  { model: 'badgeDefinition', scope: { kind: 'family' }, why: 'badge definitions' },
  { model: 'rewardRedemption', scope: { kind: 'family' }, why: 'reward redemptions' },
  { model: 'reward', scope: { kind: 'family' }, why: 'rewards' },
  { model: 'familyGoal', scope: { kind: 'family' }, why: 'goals' },
  { model: 'mealPlanEntry', scope: { kind: 'parent', relation: 'meal_plan' }, why: 'legacy meal plan entries' },
  { model: 'mealPlan', scope: { kind: 'family' }, why: 'legacy meal plans' },
  { model: 'shoppingItem', scope: { kind: 'parent', relation: 'shopping_list' }, why: 'legacy shopping items' },
  { model: 'shoppingList', scope: { kind: 'family' }, why: 'legacy shopping lists' },
  { model: 'familyMeal', scope: { kind: 'family' }, why: 'meals' },
  { model: 'recipeIngredient', scope: { kind: 'parent', relation: 'recipe' }, why: 'recipe ingredients' },
  { model: 'recipe', scope: { kind: 'family' }, why: 'recipes' },
  { model: 'ingredient', scope: { kind: 'family' }, why: 'ingredients' },
  { model: 'importedRecord', scope: { kind: 'family' }, why: 'import provenance' },
  { model: 'importJob', scope: { kind: 'family' }, why: 'import jobs' },
  { model: 'financialArchiveRecord', scope: { kind: 'family' }, why: 'archived finance records' },
  { model: 'message', scope: { kind: 'family' }, why: 'messages' },
  { model: 'notification', scope: { kind: 'members', column: 'user_id' }, why: 'notifications' },
  { model: 'activity', scope: { kind: 'family' }, why: 'activity feed' },
  { model: 'pinnedNote', scope: { kind: 'family' }, why: 'notes' },
  { model: 'anniversary', scope: { kind: 'family' }, why: 'anniversaries' },
  { model: 'familyLocation', scope: { kind: 'family' }, why: 'addresses' },
  { model: 'emergencyContact', scope: { kind: 'family' }, why: 'emergency cards' },
  { model: 'pickup', scope: { kind: 'family' }, why: 'pickups' },
  { model: 'allowance', scope: { kind: 'family' }, why: 'allowance' },
  { model: 'wishlistItem', scope: { kind: 'family' }, why: 'wishlist' },
  { model: 'medication', scope: { kind: 'family' }, why: 'medications' },
  { model: 'sickDay', scope: { kind: 'family' }, why: 'sick days' },
  { model: 'upload', scope: { kind: 'family' }, why: 'upload ownership rows (files removed after commit)' },
  { model: 'weatherCache', scope: { kind: 'family' }, why: 'weather cache' },
  // 5. Accounts, then the household row.
  { model: 'user', scope: { kind: 'family' }, why: 'member accounts' },
]

/** Models that are not household data (or are the household row itself). */
export const NOT_HOUSEHOLD_SCOPED = ['family', 'rateLimitEntry'] as const

function whereFor(scope: Scope, familyId: string, memberIds: string[]): Record<string, unknown> {
  switch (scope.kind) {
    case 'family':
      return { family_id: familyId }
    case 'members':
      return { [scope.column]: { in: memberIds } }
    case 'familyOrMembers':
      return { OR: [{ family_id: familyId }, { [scope.column]: { in: memberIds } }] }
    case 'parent':
      return { [scope.relation]: { family_id: familyId } }
  }
}

/**
 * Delete a whole household and every member account in it. `actorUserId`
 * must be a parent of `familyId` and its only parent.
 */
export async function deleteHousehold(
  familyId: string,
  actorUserId: string,
  deps: DeletionDeps = {}
): Promise<HouseholdDeletionResult> {
  const db = dbOf(deps)
  const root = uploadRoot(deps)
  const now = (deps.now ?? (() => new Date()))()

  const exists = await db.family.findUnique({ where: { id: familyId }, select: { id: true } })
  if (!exists) return { mode: 'household', deleted: false, membersRemoved: 0, filesRemoved: 0, filesNotRemoved: 0 }
  await assertOnlyParent(db, familyId, actorUserId)

  const outcome = await db.$transaction(
    async (tx: any) => {
      await lockHousehold(tx, familyId)
      const family = await tx.family.findUnique({ where: { id: familyId }, select: { id: true } })
      if (!family) return { deleted: false, membersRemoved: 0, files: [] as FileTarget[], grants: [] as CalendarGrant[] }
      await assertOnlyParent(tx, familyId, actorUserId)

      const members = await tx.user.findMany({ where: { family_id: familyId }, select: { id: true } })
      const memberIds = members.map((m: { id: string }) => m.id)

      // 2. Revoke every member session first (defence in depth: the rows are
      // deleted below in the same transaction).
      await tx.user.updateMany({
        where: { id: { in: memberIds } },
        data: {
          token_version: { increment: 1 },
          reset_token: null,
          reset_token_expires: null,
          verify_token: null,
          verify_token_expires: null,
        },
      })
      await tx.deviceSession.updateMany({ where: { family_id: familyId, revoked_at: null }, data: { revoked_at: now } })
      await tx.family.update({ where: { id: familyId }, data: { feed_token: null } })

      // Calendar connections of the household: grants kept for the revoke
      // after commit; links, imported events and rows deleted here.
      const grants = await takeCalendarConnections(tx, { family_id: familyId })

      // 3. Files to remove after commit: every Upload of the household, and
      // legacy photo files referenced only by this household.
      const [uploads, choresWithPhotos, assignmentsWithPhotos] = await Promise.all([
        tx.upload.findMany({ where: { family_id: familyId }, select: { filename: true } }),
        tx.chore.findMany({ where: { family_id: familyId, photo_url: { not: null } }, select: { photo_url: true } }),
        tx.choreAssignment.findMany({
          where: { family_id: familyId, photo_url: { not: null } },
          select: { photo_url: true },
        }),
      ])
      const files: FileTarget[] = []
      const owned = new Set<string>()
      for (const u of uploads) {
        owned.add(u.filename)
        const p = resolveUnder(root, 'chores', u.filename)
        if (p) files.push({ path: p })
      }
      const legacyUrls = [
        ...new Set([...choresWithPhotos, ...assignmentsWithPhotos].map((r: { photo_url: string }) => r.photo_url)),
      ].filter((url) => !owned.has(photoRefName(url)))
      const shared = await photoNamesUsedElsewhere(tx, familyId, legacyUrls.map(photoRefName))
      const legacyNames = legacyUrls.filter((u) => !shared.has(photoRefName(u))).map(photoRefName)
      const foreignOwned = legacyNames.length
        ? await tx.upload.findMany({ where: { filename: { in: legacyNames } }, select: { filename: true } })
        : []
      const foreign = new Set(foreignOwned.map((u: { filename: string }) => u.filename))
      for (const url of legacyUrls) {
        if (shared.has(photoRefName(url))) continue
        for (const p of legacyPhotoPaths(root, url)) {
          if (!foreign.has(path.basename(p))) files.push({ path: p })
        }
      }

      // 4. Every household-scoped table, in order.
      for (const step of HOUSEHOLD_DELETION_PLAN) {
        await tx[step.model].deleteMany({ where: whereFor(step.scope, familyId, memberIds) })
      }
      // 5. The household row.
      await tx.family.delete({ where: { id: familyId } })
      return { deleted: true, membersRemoved: memberIds.length, files, grants }
    },
    { timeout: 120_000 }
  )

  await revokeGrantsAfterCommit(outcome.grants, deps)
  const cleanup = await removeFiles(outcome.files, deps)
  if (outcome.deleted) {
    log.info('account_deletion.household', { membersRemoved: outcome.membersRemoved, ...cleanup })
  }
  return { mode: 'household', deleted: outcome.deleted, membersRemoved: outcome.membersRemoved, ...cleanup }
}

async function assertOnlyParent(db: any, familyId: string, actorUserId: string): Promise<void> {
  const actor = await db.user.findUnique({ where: { id: actorUserId }, select: { role: true, family_id: true } })
  if (!actor || actor.family_id !== familyId) {
    throw new AccountDeletionError('FAMILY_REQUIRED', 403, 'Forbidden')
  }
  if (actor.role !== 'parent') {
    throw new AccountDeletionError('PARENT_REQUIRED', 403, 'Only a parent can delete the household.')
  }
  const otherParents = await db.user.count({ where: { family_id: familyId, role: 'parent', id: { not: actorUserId } } })
  if (otherParents > 0) {
    throw new AccountDeletionError(
      'OTHER_PARENTS_EXIST',
      409,
      'Another parent is still in this household. Each parent deletes their own account; the last parent can then delete the household.'
    )
  }
}
