/** Final original-owner renewal after effect/notification/receipt waits.
 * A hold may follow a committed mutation; it is never rollback proof.
 */
import { NextResponse } from "next/server";
import type { PrismaClient } from "@prisma/client";
import { authorizeRewardReplay, type RewardActor } from "@/lib/reward-mutations";
export async function protectRewardResponse(
  db: Pick<PrismaClient, "$transaction">, actor: RewardActor, parentOnly: boolean, response: NextResponse, disclosure: "read" | "write" = "write",
) {
  const message = disclosure === "read" ? "Reward access could not be confirmed. Reload rewards before continuing."
    : "Your reward request may have been saved. Reload before trying again.";
  response.headers.set("Cache-Control", "private, no-store");
  // Known refusals carry no reward/XP envelope; preserve their original reason.
  if (!response.ok) return response;
  try {
    const refused = await authorizeRewardReplay(db, actor, parentOnly);
    if (refused) {
      const body = refused.body && typeof refused.body === "object" ? refused.body as Record<string, unknown> : null;
      const code = typeof body?.code === "string" && body.code.startsWith("REWARD_COMMAND_") ? body.code : "REWARD_ACCESS_CHANGED";
      return NextResponse.json({ error: message, code }, { status: refused.status, headers: { "Cache-Control": "private, no-store" } });
    }
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch {
    return NextResponse.json({ error: message, code: "REWARD_ACCESS_UNCONFIRMED" },
      { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
