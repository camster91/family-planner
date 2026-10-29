import type { AssistantProofActor } from "@/lib/assistant-source-proof";
import { normalizeFeatures, isFeatureEnabled } from "@/lib/features";
import { canCreateList } from "@/lib/role-capabilities";
import type { EffectResult } from "@/lib/idempotency";
import type { D1ReadClient } from "./read-client";
export async function authorizeD1Lists(
  db: D1ReadClient,
  actor: AssistantProofActor,
  create = false,
): Promise<EffectResult | null> {
  const user = await db.user.findUnique({
    where: { id: actor.userId },
    select: { family_id: true, role: true, token_version: true },
  });
  if (
    !user ||
    user.family_id !== actor.familyId ||
    user.role !== actor.role ||
    user.token_version !== actor.generation
  )
    return { status: 401, body: { error: "Unauthorized" } };
  if (
    !["parent", "teen", "child"].includes(user.role) ||
    (create && !canCreateList(user.role))
  )
    return {
      status: 403,
      body: { error: "Ask a parent to create a new list." },
    };
  const family = await db.family.findUnique({
    where: { id: actor.familyId },
    select: { features: true },
  });
  if (!family) return { status: 404, body: { error: "Household not found" } };
  if (!isFeatureEnabled(normalizeFeatures(family.features), "lists"))
    return {
      status: 403,
      body: { error: "This feature is turned off for your family" },
    };
  return null;
}
