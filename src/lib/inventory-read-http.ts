import { NextResponse } from "next/server";
import {
  checkInventoryReadScope,
  inventoryReadScopeValue,
  INVENTORY_READ_SCOPE_HEADER,
  type InventoryReadScope,
} from "@/lib/inventory-read-scope";
export function refuseInventoryReadScope(
  request: Request,
  scope: InventoryReadScope,
): NextResponse | null {
  const state = checkInventoryReadScope(request.headers, scope);
  return state === "invalid" || state === "changed"
    ? NextResponse.json(
        {
          error: {
            code:
              state === "changed"
                ? "AUTH_CONTEXT_CHANGED"
                : "INVALID_READ_CONTEXT",
          },
        },
        {
          status: state === "changed" ? 403 : 400,
          headers: { "Cache-Control": "private, no-store" },
        },
      )
    : null;
}
export function inventoryScopedResponse(
  response: NextResponse,
  scope: InventoryReadScope,
): NextResponse {
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set(
    INVENTORY_READ_SCOPE_HEADER,
    inventoryReadScopeValue(scope),
  );
  return response;
}
