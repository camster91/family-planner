import type { NextRequest } from "next/server";
import { readOwnedReward } from "@/lib/reward-owned-read";
import { REWARD_ACTION_PROTOCOL, REWARD_ACTION_PROTOCOL_HEADER } from "@/lib/reward-action-shared";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const response = await readOwnedReward(request);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set(REWARD_ACTION_PROTOCOL_HEADER, REWARD_ACTION_PROTOCOL);
  return response;
}
