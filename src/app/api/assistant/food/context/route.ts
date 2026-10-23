import type { NextRequest } from "next/server";
import { handleFoodHttp } from "@/lib/food-planning/http";
export const dynamic = "force-dynamic";
export const GET = (request: NextRequest) => handleFoodHttp(request, "context");
