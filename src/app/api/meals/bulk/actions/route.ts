import { NextRequest } from "next/server";
import { mealPrepMutation } from "@/lib/meal-batch-api";
export const dynamic = "force-dynamic";
export const POST = (request: NextRequest) =>
  mealPrepMutation(request, "action");
