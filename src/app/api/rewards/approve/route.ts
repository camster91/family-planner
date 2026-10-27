import type { NextRequest } from "next/server";
import { handleRewardApprovalRequest } from "@/lib/reward-approve-http";
export const dynamic = "force-dynamic";
/** Legacy compatibility wrapper; canonical mutation remains shared. */
export async function POST(request: NextRequest) { return handleRewardApprovalRequest(request, "legacy"); }
