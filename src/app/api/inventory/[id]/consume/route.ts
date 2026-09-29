import { NextRequest } from "next/server";
import { handleAdjust, type ItemContext } from "@/lib/inventory-adjust-route";

export const dynamic = "force-dynamic";

/**
 * POST /api/inventory/[id]/consume?today= (#158/#121) — "Used it". Body
 * `{ amount?: number | null }`: omitted or null uses the whole item; a
 * positive amount smaller than the item's leaves the rest. Parent or teen;
 * paired device refused. Optional `Idempotency-Key`. 200 `{ item, adjustment }`.
 */
export async function POST(request: NextRequest, context: ItemContext) {
  return handleAdjust(request, context, "consume");
}
