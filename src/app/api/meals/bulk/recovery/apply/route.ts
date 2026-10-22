import type { NextRequest } from "next/server";
import { handlePrepRecoveryHttp } from "@/lib/meal-prep-recovery/http";
export const dynamic = "force-dynamic";
export function POST(request: NextRequest) {
  return handlePrepRecoveryHttp(request, "apply");
}
