import {
  refuseInventoryReadScope,
  inventoryScopedResponse,
} from "@/lib/inventory-read-http";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateWithFamily } from "@/lib/api-auth";
import { featureGate } from "@/lib/feature-gate-server";
import {
  COOK_DEFAULT_LIMIT,
  COOK_MAX_LIMIT,
  getCookSuggestions,
} from "@/lib/inventory";
import { inventoryError, inventoryJson, todayFrom } from "@/lib/inventory-http";
import { logRouteError } from "@/lib/api-error";
import { getRequestId } from "@/lib/request-id";

export const dynamic = "force-dynamic";

/**
 * GET /api/inventory/cook?today=&limit= (#263) — "What can I cook". The
 * household's saved recipes ranked by how many of their ingredients are in
 * stock (non-expired items, matched by ingredient link, else by normalized
 * name for unlinked items), each with `have` and `missing` ingredient ids and
 * names. Recipes with nothing in stock are left out. Every role may read.
 * Needs `inventory` and `meals` (recipes live under meals).
 */
async function handle(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request);
    if (error) return error;
    const readScope = { userId: auth.user.id, familyId: auth.user.family_id };
    const scopeRefusal = refuseInventoryReadScope(request, readScope);
    if (scopeRefusal) return scopeRefusal;

    const gate = await featureGate(auth.user.family_id, "inventory");
    if (gate) return gate;
    const mealsGate = await featureGate(auth.user.family_id, "meals");
    if (mealsGate) return mealsGate;

    const { searchParams } = new URL(request.url);
    const today = todayFrom(searchParams);
    if (today instanceof NextResponse) return today;
    const limitRaw = searchParams.get("limit");
    const limit = limitRaw === null ? COOK_DEFAULT_LIMIT : Number(limitRaw);
    if (!Number.isInteger(limit) || limit < 1 || limit > COOK_MAX_LIMIT) {
      return inventoryError(
        400,
        "VALIDATION_ERROR",
        `limit must be 1-${COOK_MAX_LIMIT}`,
      );
    }

    const result = await getCookSuggestions(prisma!, auth.user.family_id, {
      today,
      limit,
    });
    return inventoryScopedResponse(inventoryJson(result), readScope);
  } catch (err) {
    logRouteError("GET /api/inventory/cook", err, getRequestId(request));
    return inventoryError(500, "INTERNAL_ERROR", "Internal server error");
  }
}

export async function GET(request: NextRequest) {
  const response = await handle(request);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
