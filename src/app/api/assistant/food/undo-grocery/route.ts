import type { NextRequest } from "next/server";
import { handleFoodHttp } from "@/lib/food-planning/http";
export const dynamic = "force-dynamic";
export function POST(request: NextRequest) {
  return handleFoodHttp(request, "undo-grocery");
}
