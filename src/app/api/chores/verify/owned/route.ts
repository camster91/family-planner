import type { NextRequest } from "next/server";
import { handleChoreCheckRequest } from "@/lib/chore-check-http";
export const dynamic = "force-dynamic";
/** No legacy endpoint fallback. Every refusal/result remains private. */
export async function POST(request: NextRequest) {
  const response = await handleChoreCheckRequest(request, "owned");
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
