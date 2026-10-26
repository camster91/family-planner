/** Shared bounded API/SSR read scope. Authorization is renewed from the
 * original authenticated actor, never from a newer role/session generation.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { authorizeRewardActorInTx, type RewardActor } from "@/lib/reward-mutations";
import type { EffectResult } from "@/lib/idempotency";
export async function withRewardReadAccess<T>(
  db: Pick<PrismaClient, "$transaction">, original: RewardActor,
  read: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<{ kind: "data"; value: T } | { kind: "held"; result: EffectResult }> {
  // Every current HTTP/SSR caller must carry an original session generation.
  if (original.tokenVersion === undefined || !["parent", "teen", "child"].includes(original.role))
    return { kind: "held", result: { status: 401, body: { error: "Unauthorized", code: "REWARD_ACCESS_CHANGED" } } };
  return db.$transaction(async tx => {
    const refusal = await authorizeRewardActorInTx(tx, original, false);
    if (refusal) return { kind: "held" as const, result: refusal };
    return { kind: "data" as const, value: await read(tx) };
  }, { timeout: 5000, maxWait: 5000 });
}
