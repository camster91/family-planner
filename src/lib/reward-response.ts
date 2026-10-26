/** Final original-owner renewal after effect/notification/receipt waits.
 * A hold may follow a committed mutation; it is never rollback proof.
 */
import { NextResponse } from "next/server";
import type { PrismaClient } from "@prisma/client";
import { authorizeRewardActorInTx, authorizeRewardReplay, type RewardActor } from "@/lib/reward-mutations";
import { projectRewardMutationPeople } from "@/lib/reward-people";
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
    if (disclosure === "write") {
      // This boundary also receives completed idempotency replays, which can
      // contain old names. Never return their stored relationship objects.
      const envelope: unknown = await response.json();
      const scope = await db.$transaction(async tx => {
        const held = await authorizeRewardActorInTx(tx, actor, parentOnly);
        if (held) return { kind: "held" as const, result: held };
        return { kind: "data" as const, body: await projectRewardMutationPeople(tx, actor.familyId, envelope) };
      }, { timeout: 5000, maxWait: 5000 });
      const lateRefusal = scope.kind === "held" ? scope.result : await authorizeRewardReplay(db, actor, parentOnly);
      if (lateRefusal) {
        const body = lateRefusal.body && typeof lateRefusal.body === "object" ? lateRefusal.body as Record<string, unknown> : null;
        const code = typeof body?.code === "string" && body.code.startsWith("REWARD_COMMAND_") ? body.code : "REWARD_ACCESS_CHANGED";
        return NextResponse.json({ error: message, code }, { status: lateRefusal.status, headers: { "Cache-Control": "private, no-store" } });
      }
      if (scope.kind !== "data") throw new Error("Reward response held");
      const headers = new Headers(response.headers);
      headers.delete("Content-Length");
      headers.delete("Content-Encoding");
      return NextResponse.json(scope.body, { status: response.status, headers });
    }
    return response;
  } catch {
    return NextResponse.json({ error: message, code: "REWARD_ACCESS_UNCONFIRMED" },
      { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
