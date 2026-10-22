import type { NextRequest } from "next/server";
import { handleFoodHttp } from "@/lib/food-planning/http";
export const dynamic = "force-dynamic";
export const POST = (request: NextRequest) =>
  handleFoodHttp(request, "inspect");
