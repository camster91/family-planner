/** Shared current personal list-item authority. Target/receipt decisions stay with each operation. */
import type { Prisma } from "@prisma/client";
import type { AssistantSourceGuard } from "./assistant-source-proof";
import { lockUser, lockHousehold } from "./household-lock";
import { canCreateList } from "./role-capabilities";
import { isFeatureEnabled, normalizeFeatures } from "./features";
type Tx = Prisma.TransactionClient;
export type PersonListItemActor = { familyId: string; addedBy: string; role: string; generation: number };
export type PersonListItemAuthorityRefusal = { status: 401 | 403 | 404; body: { error: string } };
export type PersonListItemOptions = { groceryOnly?: boolean; sourceGuard?: AssistantSourceGuard; requireListCreation?: boolean };
export async function authorizePersonListItemInTx(tx: Tx, actor: PersonListItemActor, options: PersonListItemOptions): Promise<PersonListItemAuthorityRefusal | null> {
  await lockUser(tx, actor.addedBy);
  await lockHousehold(tx, actor.familyId);
  const user = await tx.user.findUnique({ where: { id: actor.addedBy },
    select: { family_id: true, role: true, token_version: true } });
  if (!user || user.family_id !== actor.familyId || user.role !== actor.role || user.token_version !== actor.generation)
    return { status: 401, body: { error: "Unauthorized" } };
  if (!["parent", "teen", "child"].includes(user.role) || (options.requireListCreation && !canCreateList(user.role)))
    return { status: 403, body: { error: "This account cannot perform this list action" } };
  await tx.$queryRaw`SELECT "id" FROM "Family" WHERE "id"=${actor.familyId} FOR SHARE`;
  const family = await tx.family.findUnique({ where: { id: actor.familyId }, select: { features: true } });
  if (!family) return { status: 404, body: { error: "Household not found" } };
  if (!isFeatureEnabled(normalizeFeatures(family.features), "lists"))
    return { status: 403, body: { error: "This feature is turned off for your family" } };
  await options.sourceGuard?.authorize(tx);
  return null;
}

