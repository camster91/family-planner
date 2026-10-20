/** Authored for the later consolidated QA pass. */
import { cookingLots } from "../inventory-cooking-lots";
import type { InventoryItemDto } from "../inventory";
const ingredient = { ingredientId: "fixture-beans", name: "Fixture beans" };
const lot: InventoryItemDto = {
  id: "lot-a",
  name: "Fixture beans",
  ingredient_id: null,
  amount: 2,
  unit: "cans",
  location: "pantry",
  expires_on: "2026-10-30",
  date_kind: "best_before",
  category: null,
  purchased_on: null,
  opened_on: null,
  status: "active",
  finished_at: null,
  added_by: "fixture-parent",
  created_at: "2026-10-20T12:00:00.000Z",
  updated_at: "2026-10-20T12:00:00.000Z",
  expiry: { status: "later", daysLeft: 10 },
};
it("keeps linked and unlinked-name lots distinct and orders dates without allocating quantities", () => {
  const rows = cookingLots(
    [
      lot,
      {
        ...lot,
        id: "lot-b",
        name: "Other product name",
        ingredient_id: ingredient.ingredientId,
        unit: "g",
        amount: 400,
        expires_on: "2026-10-21",
      },
      { ...lot, id: "foreign-link", ingredient_id: "other-ingredient" },
    ],
    ingredient,
  );
  expect(
    rows.map((row) => [row.item.id, row.match, row.item.amount, row.item.unit]),
  ).toEqual([
    ["lot-b", "linked", 400, "g"],
    ["lot-a", "name", 2, "cans"],
  ]);
  expect(lot.amount).toBe(2);
});
it("excludes finished, zero, invalid, expired and unversioned lots; unknown amounts remain explicit", () => {
  const candidates = [
    { ...lot, id: "zero", amount: 0 },
    { ...lot, id: "nan", amount: NaN },
    { ...lot, id: "finished", status: "consumed" as const },
    { ...lot, id: "old", expiry: { status: "expired" as const, daysLeft: -1 } },
    {
      ...lot,
      id: "use-by",
      expiry: { status: "past_use_by" as const, daysLeft: -1 },
    },
    { ...lot, id: "unversioned", updated_at: "" },
    { ...lot, id: "unknown", amount: null },
  ];
  expect(cookingLots(candidates, ingredient).map((row) => row.item.id)).toEqual(
    ["unknown"],
  );
});
