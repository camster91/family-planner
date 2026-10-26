import { REWARD_ACTION_PROTOCOL } from "@/lib/reward-action-command";
import type { NextRequest } from "next/server";
import { handleRewardApprovalRequest } from "@/lib/reward-approve-http";
export const dynamic = "force-dynamic";
/** Strict path: no fallback to an unversioned write; all results private. */
export async function POST(request: NextRequest) {
  const response = await handleRewardApprovalRequest(request, "owned");
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Herewoven-Reward-Protocol", REWARD_ACTION_PROTOCOL);
  return response;
}
