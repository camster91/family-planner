/** Source cases authored/unrun. Pure planner only: no DB/provider imports. */
import { budgetAppExportSchema, planBudgetAppImport } from "../budget-app";
const transaction = (amount: number) => ({
  id: "synthetic-transaction",
  amount,
  description: "Synthetic fixture",
  date: "2026-10-25",
  createdAt: "2026-10-25",
});
const wish = (price: number) => ({
  id: "synthetic-wish",
  name: "Synthetic fixture",
  price,
  createdAt: "2026-10-25",
});
it("preserves ordinary existing cents, signed source values and original metadata", () => {
  for (const amount of [0, 1, -1, 1234, 1999, 100000001]) {
    const plan = planBudgetAppImport(
      { version: "synthetic-v1", transactions: [transaction(amount)] },
      "synthetic-parent",
    );
    expect(plan.transactions[0].amount).toBe(amount / 100);
    expect(plan.transactions[0].metadata.cents).toBe(amount);
  }
  expect(
    planBudgetAppImport(
      { version: "synthetic-v1", wishlistItems: [wish(29999)] },
      "synthetic-parent",
    ).wishlistItems[0].approxPrice,
  ).toBe(299.99);
});
it("refuses unsafe source numeric cents rather than preserving a rounded integer as original evidence", () => {
  for (const amount of [
    9007199254740992,
    -9007199254740992,
    1.5,
    Infinity,
    -0,
  ]) {
    expect(
      budgetAppExportSchema.safeParse({
        version: "synthetic-v1",
        transactions: [transaction(amount)],
      }).success,
    ).toBe(false);
    expect(
      budgetAppExportSchema.safeParse({
        version: "synthetic-v1",
        wishlistItems: [wish(amount)],
      }).success,
    ).toBe(false);
  }
});
it("refuses safe-integer cents whose Float-major roundtrip loses a cent", () => {
  // Safe source integer; dividing into the old Float major unit loses a cent.
  for (const amount of [9007199254740991, -9007199254740991]) {
    expect(Number.isSafeInteger(amount)).toBe(true);
    expect(() =>
      planBudgetAppImport(
        { version: "synthetic-v1", transactions: [transaction(amount)] },
        "synthetic-parent",
      ),
    ).toThrow("Source cents cannot be represented exactly");
  }
  expect(
    budgetAppExportSchema.safeParse({
      version: "synthetic-v1",
      wishlistItems: [wish(9007199254740991)],
    }).success,
  ).toBe(false);
});
it("keeps metadata-only daily caps exact without requiring a Float-major mapping", () => {
  const category = {
    id: "synthetic-category",
    name: "Synthetic fixture",
    dailyCap: Number.MAX_SAFE_INTEGER,
    createdAt: "2026-10-25",
  };
  expect(
    planBudgetAppImport(
      { version: "synthetic-v1", categories: [category] },
      "synthetic-parent",
    ).categories[0].metadata.dailyCapCents,
  ).toBe(Number.MAX_SAFE_INTEGER);
  expect(
    budgetAppExportSchema.safeParse({
      version: "synthetic-v1",
      categories: [{ ...category, dailyCap: 9007199254740992 }],
    }).success,
  ).toBe(false);
});
it("preserves existing negative-wishlist refusal and explicit nullable daily caps", () => {
  expect(
    budgetAppExportSchema.safeParse({
      version: "synthetic-v1",
      wishlistItems: [wish(-1)],
    }).success,
  ).toBe(false);
  expect(
    budgetAppExportSchema.safeParse({
      version: "synthetic-v1",
      categories: [
        {
          id: "synthetic-category",
          name: "Synthetic fixture",
          dailyCap: null,
          createdAt: "2026-10-25",
        },
      ],
    }).success,
  ).toBe(true);
});
