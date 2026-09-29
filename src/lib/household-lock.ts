/**
 * Membership locks (D-3 review, docs/product/ACCOUNT_DELETION.md "Concurrency").
 *
 * Two transaction-scoped Postgres advisory locks, released at commit:
 *
 * - **Household lock** (`household-membership:<familyId>`). Household deletion
 *   and member deletion hold it from before they read the member list until
 *   they commit. Everything that adds to a household and must not outlive a
 *   deletion takes it in its own transaction and re-checks that the household
 *   still exists: joins (`POST /api/family/join`, `POST /api/auth/register`
 *   with an invite), calendar connections (`commitConnection`, the OAuth
 *   callback) and uploads (`POST /api/upload`).
 * - **User lock** (`user-membership:<userId>`). Account deletion holds it from
 *   before it reads the member's `family_id`. Every path that attaches an
 *   existing account to a household (`POST /api/family` create, join) takes it
 *   and re-checks the account under it.
 *
 * Without them a write could commit between a deletion's read and its delete:
 * a join after the members were deleted leaves an account with
 * `family_id = NULL` (`User.family` is ON DELETE SET NULL); a family created
 * for a user who is being deleted leaves a Family with no members; a calendar
 * grant or an uploaded file committed after the deletion's snapshot is never
 * cleaned up.
 *
 * **Acquisition order, everywhere: user lock(s) first, then the household
 * lock.** Nothing takes a user lock while holding a household lock, so two
 * transactions cannot wait on each other. Household deletion takes only the
 * household lock.
 */
export function householdLockKey(familyId: string): string {
  return `household-membership:${familyId}`
}

export function userLockKey(userId: string): string {
  return `user-membership:${userId}`
}

/** Take the household lock (blocks until any holder commits). */
export async function lockHousehold(tx: any, familyId: string): Promise<void> {
  const key = householdLockKey(familyId)
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${key}))`
}

/** Take the user lock. Must be taken before any household lock in the same transaction. */
export async function lockUser(tx: any, userId: string): Promise<void> {
  const key = userLockKey(userId)
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${key}))`
}

/**
 * Take the household lock, then report whether the household still exists.
 * A false result means it was deleted; the caller must not write into it
 * (answer 404/400/409 instead).
 */
export async function lockHouseholdForJoin(tx: any, familyId: string): Promise<boolean> {
  await lockHousehold(tx, familyId)
  const family = await tx.family.findUnique({ where: { id: familyId }, select: { id: true } })
  return Boolean(family)
}
