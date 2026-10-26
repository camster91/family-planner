/** Strict owned reward commands. Metadata is a precondition, never auth.
 * Caller must own ordered lifecycle/actual principal locks before source locks.
 */
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import type { EffectResult } from "@/lib/idempotency";
import { IDEMPOTENCY_TTL_MS } from "@/lib/idempotency-key";
import { memberIdentityIdSchema as id } from "@/lib/member-subject-contract";
export const REWARD_ACTION_PROTOCOL = "herewoven.reward-action.v1" as const;
export const rewardActionCommandsEnabled = () => process.env.REWARD_ACTION_COMMANDS_ENABLED === "1";
const common = {
  protocol: z.literal(REWARD_ACTION_PROTOCOL), rewardId: id, sourceGeneration: z.string().uuid(),
  issuedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  owner: z.object({ userId: id, familyId: id, role: z.enum(["parent", "teen", "child"]), generation: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict(),
};
export const rewardActionCommandSchema = z.discriminatedUnion("kind", [
  z.object({ ...common, kind: z.literal("claim"), expectedCost: z.number().int().min(1).max(100000) }).strict(),
  z.object({ ...common, kind: z.literal("approve"), expectedClaimantId: id.nullable() }).strict(),
]);
export type RewardActionCommand = z.infer<typeof rewardActionCommandSchema>;
export function rewardActionOwnerMatches(command: RewardActionCommand, actor: { userId: string; familyId: string; role: string; tokenVersion?: number }) {
  return command.owner.userId === actor.userId && command.owner.familyId === actor.familyId
    && command.owner.role === actor.role && command.owner.generation === actor.tokenVersion;
}
const refuse = (status: number, code: string): EffectResult => ({ status, body: { error: code, code } });
export function rewardActionTimeRefusal(command: RewardActionCommand, now = Date.now()): EffectResult | null {
  if (!Number.isSafeInteger(now) || now < command.issuedAt) return refuse(409, "REWARD_COMMAND_TIME_UNCONFIRMED");
  return now - command.issuedAt >= IDEMPOTENCY_TTL_MS ? refuse(410, "REWARD_COMMAND_EXPIRED") : null;
}
export async function checkRewardActionSourceInTx(
  tx: Prisma.TransactionClient, command: RewardActionCommand,
  actor: { userId: string; familyId: string; role: string; tokenVersion?: number },
): Promise<EffectResult | null> {
  if (!rewardActionCommandSchema.safeParse(command).success || !rewardActionOwnerMatches(command, actor)) return refuse(409, "REWARD_COMMAND_OWNER_CHANGED");
  const expired = rewardActionTimeRefusal(command);
  if (expired) return expired;
  const rows = command.kind === "claim"
    ? await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Reward" WHERE "id" = ${command.rewardId} AND "family_id" = ${actor.familyId}
      AND "notification_generation" = ${command.sourceGeneration} AND "cost" = ${command.expectedCost} FOR UPDATE`
    : await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Reward" WHERE "id" = ${command.rewardId} AND "family_id" = ${actor.familyId}
      AND "notification_generation" = ${command.sourceGeneration} AND "claimed_by" IS NOT DISTINCT FROM ${command.expectedClaimantId}::text FOR UPDATE`;
  if (rows.length !== 1) return refuse(409, "REWARD_COMMAND_SOURCE_CHANGED");
  return rewardActionTimeRefusal(command);
}
