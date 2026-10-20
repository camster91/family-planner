import type { Prisma } from "@prisma/client";

type Target = { family_id: string; target_model: string; target_id: string };
/** Only personal targets that permanent account deletion removes. Shared
 * Habit/Reward/BadgeDefinition/import jobs are deliberately not targets. */
export async function accountErasureImportTargets(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<Target[]> {
  const chores = await tx.chore.findMany({
    where: { assigned_to: userId },
    select: { id: true, family_id: true },
  });
  const [assignments, logs, badges, redemptions, wishes] = await Promise.all([
    tx.choreAssignment.findMany({
      where: {
        OR: [
          { assigned_to: userId },
          { chore_id: { in: chores.map((row) => row.id) } },
        ],
      },
      select: { id: true, family_id: true },
    }),
    tx.habitLog.findMany({
      where: { user_id: userId },
      select: { id: true, family_id: true },
    }),
    tx.earnedBadge.findMany({
      where: { user_id: userId },
      select: { id: true, family_id: true },
    }),
    tx.rewardRedemption.findMany({
      where: { requested_by: userId },
      select: { id: true, family_id: true },
    }),
    tx.wishlistItem.findMany({
      where: { requested_by: userId },
      select: { id: true, family_id: true },
    }),
  ]);
  return [
    ...chores.map((row) => ({ ...row, target_model: "Chore" })),
    ...assignments.map((row) => ({ ...row, target_model: "ChoreAssignment" })),
    ...logs.map((row) => ({ ...row, target_model: "HabitLog" })),
    ...badges.map((row) => ({ ...row, target_model: "EarnedBadge" })),
    ...redemptions.map((row) => ({ ...row, target_model: "RewardRedemption" })),
    ...wishes.map((row) => ({ ...row, target_model: "WishlistItem" })),
  ].map(({ id, family_id, target_model }) => ({
    family_id,
    target_model,
    target_id: id,
  }));
}

/** Account lock precedes stable household locks. Discovery includes historical
 * personal targets even if the account no longer belongs to any household. */
export async function accountErasureImportHouseholds(
  tx: Prisma.TransactionClient,
  userId: string,
) {
  return [
    ...new Set(
      (await accountErasureImportTargets(tx, userId)).map(
        (row) => row.family_id,
      ),
    ),
  ].sort();
}

/** Caller holds discovered household locks. Re-read inside them before personal
 * rows/cascades disappear. Keep the established removal policy for provenance:
 * no new tombstones or changes to normal import replay/mapping behavior. */
export async function erasePersonalImportProvenanceInTx(
  tx: Prisma.TransactionClient,
  userId: string,
  lockedHouseholds: readonly string[],
) {
  const targets = await accountErasureImportTargets(tx, userId);
  const locked = new Set(lockedHouseholds);
  if (targets.some((row) => !locked.has(row.family_id)))
    throw new Error(
      "Account import provenance changed household scope during erasure.",
    );
  for (const familyId of [
    ...new Set(targets.map((row) => row.family_id)),
  ].sort()) {
    const familyTargets = targets.filter((row) => row.family_id === familyId);
    // A long-lived household may retain years of personal logs. Bound each
    // predicate without weakening its exact model/record ownership pairs.
    for (let offset = 0; offset < familyTargets.length; offset += 200) {
      await tx.importedRecord.deleteMany({
        where: {
          family_id: familyId,
          OR: familyTargets
            .slice(offset, offset + 200)
            .map(({ target_model, target_id }) => ({
              target_model,
              target_id,
            })),
        },
      });
    }
  }
}
