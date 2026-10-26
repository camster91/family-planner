/** Internal original-account scope. All participants precede household/source/
 * receipt locks. IDs are preconditions, never authenticated credentials.
 */
import type { Prisma } from "@prisma/client";
import type { NotificationEventActor } from "@/lib/notification-event-admission";
import { lockUser, lockHousehold } from "@/lib/household-lock";
import { isFeatureEnabled, normalizeFeatures } from "@/lib/features";
export type RewardNotificationPerson = { id: string; family_id: string | null; role: string; token_version: number };
export async function lockRewardNotificationParticipants(tx: Prisma.TransactionClient, original: NotificationEventActor, candidates: readonly string[]) {
  const ids = [...new Set([original.userId, ...candidates])].sort();
  for (const id of ids) await lockUser(tx, id);
  await lockHousehold(tx, original.familyId);
  const people = await tx.$queryRaw<RewardNotificationPerson[]>`
    SELECT "id", "family_id", "role", "token_version" FROM "User" WHERE "id" = ANY(${ids}::text[]) ORDER BY "id" FOR SHARE`;
  const actor = people.find(row => row.id === original.userId);
  if (actor?.family_id !== original.familyId || actor.role !== original.role || actor.token_version !== original.tokenVersion)
    throw new Error("Reward notification authority held");
  const families = await tx.$queryRaw<Array<{ features: unknown }>>`
    SELECT "features" FROM "Family" WHERE "id" = ${original.familyId} FOR SHARE`;
  if (families.length !== 1 || !isFeatureEnabled(normalizeFeatures(families[0].features), "rewards"))
    throw new Error("Reward notification authority held");
  return people;
}
