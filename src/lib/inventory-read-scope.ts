/** Optional old-client compatible read binding; new owner-bound readers require its echo. */
import { z } from "zod";
export const INVENTORY_READ_SCOPE_HEADER = "X-Herewoven-Inventory-Scope";
const scopeSchema = z
  .object({
    userId: z.string().min(1).max(128),
    familyId: z.string().min(1).max(128),
  })
  .strict();
export type InventoryReadScope = z.infer<typeof scopeSchema>;
export function inventoryReadScopeValue(scope: InventoryReadScope): string {
  return `v1.${encodeURIComponent(JSON.stringify(scopeSchema.parse(scope)))}`;
}
export function checkInventoryReadScope(
  headers: Headers,
  scope: InventoryReadScope,
): "unbound" | "matched" | "invalid" | "changed" {
  const raw = headers.get(INVENTORY_READ_SCOPE_HEADER);
  if (raw === null) return "unbound";
  if (raw.length > 4096 || !raw.startsWith("v1.")) return "invalid";
  try {
    const parsed = scopeSchema.parse(
      JSON.parse(decodeURIComponent(raw.slice(3))),
    );
    return parsed.userId === scope.userId && parsed.familyId === scope.familyId
      ? "matched"
      : "changed";
  } catch {
    return "invalid";
  }
}
