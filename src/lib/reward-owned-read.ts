/** Original-owner current read, independent of any expired/uncertain write.
 * No automatic packet renewal or re-adoption of a changed source.
 */
import { NextRequest, NextResponse } from "next/server";
import { authenticateWithFamily } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { withRewardReadAccess } from "@/lib/reward-read-access";
import { protectRewardResponse } from "@/lib/reward-response";
import { rewardActionCommandsEnabled, rewardActionOwnerSchema } from "@/lib/reward-action-command";
import { REWARD_ACTION_PROTOCOL, REWARD_ACTION_OWNER_HEADER, sameRewardActionOwner } from "@/lib/reward-action-shared";
import { MEMBER_ID_PATTERN } from "@/lib/member-identity-schema";
const headers = { "Cache-Control": "private, no-store" };
const fail = (status: number, code: string) => NextResponse.json({ error: code, code }, { status, headers });
export async function readOwnedReward(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request);
    if (error) { error.headers.set("Cache-Control", "private, no-store"); return error; }
    if (!rewardActionCommandsEnabled()) return fail(503, "REWARD_COMMAND_UNAVAILABLE");
    const raw = request.headers.get(REWARD_ACTION_OWNER_HEADER);
    let owner;
    try { owner = raw && raw.length <= 1024 ? rewardActionOwnerSchema.parse(JSON.parse(raw)) : null; }
    catch { return fail(400, "REWARD_COMMAND_INVALID"); }
    const currentOwner = { userId: auth.user.id, familyId: auth.user.family_id, role: auth.user.role, generation: auth.payload.tv ?? 0 };
    if (!owner || !sameRewardActionOwner(currentOwner, owner)) return fail(409, "REWARD_COMMAND_OWNER_CHANGED");
    const params = new URL(request.url).searchParams;
    const id = params.get("rewardId");
    if (!id || !MEMBER_ID_PATTERN.test(id) || params.getAll("rewardId").length !== 1 || [...params.keys()].some(key => key !== "rewardId")) return fail(400, "REWARD_COMMAND_INVALID");
    const actor = { userId: owner.userId, familyId: owner.familyId, role: owner.role, tokenVersion: owner.generation };
    const result = await withRewardReadAccess(prisma!, actor, tx => tx.reward.findMany({
      where: { id, family_id: owner.familyId }, take: 1,
      select: { id: true, family_id: true, name: true, description: true, cost: true, icon: true, status: true,
        is_active: true, claimed_by: true, notification_generation: true },
    }));
    if (result.kind === "held") return NextResponse.json(result.result.body, { status: result.result.status, headers });
    return protectRewardResponse(prisma!, actor, false,
      NextResponse.json({ protocol: REWARD_ACTION_PROTOCOL, owner, rewards: result.value }, { headers }), "read");
  } catch { return fail(503, "REWARD_READ_UNAVAILABLE"); }
}
