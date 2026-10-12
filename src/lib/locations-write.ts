/**
 * Transaction boundary for parent-only location mutations.
 *
 * The session is only a hint: membership, role and the locations flag are
 * re-read after the same user-before-household locks used by membership
 * deletion. This keeps a stale parent session from writing private addresses
 * after it has left the family or lost the role/feature.
 */
import type { Prisma } from "@prisma/client";
import { isFeatureEnabled, normalizeFeatures } from "@/lib/features";
import { lockHousehold, lockUser } from "@/lib/household-lock";

type LocationWriteTx = Prisma.TransactionClient;

type LocationMutation = "add" | "update" | "delete";

export type LocationMutationError = {
  status: 400 | 403;
  body: { error: string };
};

const mutationMessages: Record<LocationMutation, string> = {
  add: "Only parents can add locations",
  update: "Only parents can update locations",
  delete: "Only parents can delete locations",
};

/**
 * Acquire the canonical membership locks, then authorize the mutation from
 * fresh rows in that transaction. Call this before reading or writing a
 * private location row.
 */
export async function authorizeLocationMutationInTx(
  tx: LocationWriteTx,
  actor: { familyId: string; userId: string },
  mutation: LocationMutation,
): Promise<LocationMutationError | null> {
  await lockUser(tx, actor.userId);
  await lockHousehold(tx, actor.familyId);

  const [currentActor, family] = await Promise.all([
    tx.user.findUnique({
      where: { id: actor.userId },
      select: { family_id: true, role: true },
    }),
    tx.family.findUnique({
      where: { id: actor.familyId },
      select: { id: true, features: true },
    }),
  ]);

  if (!family || !currentActor || currentActor.family_id !== actor.familyId) {
    return { status: 400, body: { error: "No family" } };
  }
  if (currentActor.role !== "parent") {
    return { status: 403, body: { error: mutationMessages[mutation] } };
  }
  if (!isFeatureEnabled(normalizeFeatures(family.features), "locations")) {
    return {
      status: 403,
      body: { error: "This feature is turned off for your family" },
    };
  }
  return null;
}
