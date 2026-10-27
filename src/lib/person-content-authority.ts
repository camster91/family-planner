/** Base list-container/note authority. Per-record edit/delete rules remain caller-owned. */
import type { Prisma } from "@prisma/client";
import type { EffectResult } from "./idempotency";
import { lockUser, lockHousehold } from "./household-lock";
import { canCreateList } from "./role-capabilities";
import { isFeatureEnabled, normalizeFeatures } from "./features";

export type ContentWriteActor = {
  userId: string;
  familyId: string;
  role: string;
  generation: number;
};
export type ContentWriteDomain = "lists" | "notes";

export async function authorizeContentWriteInTx(
  tx: Prisma.TransactionClient,
  actor: ContentWriteActor,
  domain: ContentWriteDomain,
): Promise<EffectResult | null> {
  await lockUser(tx, actor.userId);
  await lockHousehold(tx, actor.familyId);
  const member = await tx.user.findUnique({
    where: { id: actor.userId },
    select: { family_id: true, role: true, token_version: true },
  });
  if (
    !member ||
    member.family_id !== actor.familyId ||
    member.role !== actor.role ||
    member.token_version !== actor.generation
  )
    return { status: 401, body: { error: "Unauthorized" } };
  if (
    !["parent", "teen", "child"].includes(member.role) ||
    (domain === "lists" && !canCreateList(member.role))
  )
    return {
      status: 403,
      body: { error: "Ask a parent to create a new list." },
    };
  // Protect effective permission until commit, including legacy feature writers.
  await tx.$queryRaw`SELECT "id" FROM "Family" WHERE "id"=${actor.familyId} FOR SHARE`;
  const family = await tx.family.findUnique({
    where: { id: actor.familyId },
    select: { features: true },
  });
  if (!family) return { status: 404, body: { error: "Household not found" } };
  if (!isFeatureEnabled(normalizeFeatures(family.features), domain))
    return {
      status: 403,
      body: { error: "This feature is turned off for your family" },
    };
  return null;
}

