import { normalizeName } from "@/lib/backfill/meals-groceries";
import type { InventoryItemDto } from "@/lib/inventory";
/** Same presence semantics as inventory suggestions. Never a quantity allocation. */
export function cookingLots(
  items: readonly InventoryItemDto[],
  ingredient: { ingredientId: string; name: string },
) {
  return items
    .filter(
      (item) =>
        item.status === "active" &&
        (item.amount === null ||
          (Number.isFinite(item.amount) && item.amount > 0)) &&
        !!item.updated_at &&
        !["expired", "past_use_by"].includes(item.expiry.status) &&
        (item.ingredient_id
          ? item.ingredient_id === ingredient.ingredientId
          : normalizeName(item.name) === normalizeName(ingredient.name)),
    )
    .map((item) => ({
      item,
      match: item.ingredient_id ? ("linked" as const) : ("name" as const),
    }))
    .sort(
      (a, b) =>
        (a.item.expires_on ?? "9999").localeCompare(
          b.item.expires_on ?? "9999",
        ) ||
        a.item.location.localeCompare(b.item.location) ||
        a.item.id.localeCompare(b.item.id),
    );
}
