import type { NextRequest } from "next/server";
import { handleChoreCheckRequest } from "@/lib/chore-check-http";
export const dynamic = "force-dynamic";
/** Legacy body/conditional-state compatibility. Owned commands have their own path. */
export async function POST(request: NextRequest) {
  return handleChoreCheckRequest(request, "legacy");
}
