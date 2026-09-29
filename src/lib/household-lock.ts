/**
 * Per-household membership lock (D-3 review, docs/product/ACCOUNT_DELETION.md
 * "Concurrency").
 *
 * Household deletion and member deletion take this transaction-scoped advisory
 * lock before they read the member list, and hold it until they commit. Every
 * path that adds a member to an existing household (POST /api/family/join,
 * POST /api/auth/register with an invite) takes the same lock in its own
 * transaction and then checks the household still exists.
 *
 * Without it a join could commit between the deletion's delete of the member
 * accounts and its delete of the Family row: `User.family_id` is ON DELETE SET
 * NULL, so the new account would survive without a household while the
 * deletion reported success. With it, a join either finishes first (and the
 * deletion then sees the new member) or waits and finds the household gone.
 */
export function householdLockKey(familyId: string): string {
  return `household-membership:${familyId}`
}

/** Take the lock (blocks until any holder commits). */
export async function lockHousehold(tx: any, familyId: string): Promise<void> {
  const key = householdLockKey(familyId)
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${key}))`
}

/**
 * For membership-adding paths: take the lock, then report whether the
 * household still exists. A false result means it was deleted; the caller must
 * not add the member (answer 404/400 instead).
 */
export async function lockHouseholdForJoin(tx: any, familyId: string): Promise<boolean> {
  await lockHousehold(tx, familyId)
  const family = await tx.family.findUnique({ where: { id: familyId }, select: { id: true } })
  return Boolean(family)
}
