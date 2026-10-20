import { mealCreateInput, mealCreateReceipt } from "../meal-create-contract";
const draft = {
  protocol: "herewoven.meal-create.v1",
  expected_user_id: "fixture_parent",
  expected_family_id: "fixture_family",
  issued_at: "2026-10-19T16:00:00.000Z",
  date: "2026-10-19",
  meal_type: "dinner",
  recipe_id: "fixture_recipe",
  servings: 4,
};
describe("versioned ordinary meal create envelope", () => {
  it("accepts explicit same-recipe intent with a date-only day", () => {
    expect(mealCreateInput.parse(draft)).toEqual(draft);
  });
  it.each([
    { protocol: "herewoven.meal-create.v2" },
    { expected_family_id: "" },
    { date: "2026-02-30" },
    { servings: 101 },
    { provider_context: "untrusted" },
  ])("refuses unsupported or ambiguous input %j", (change) => {
    expect(mealCreateInput.safeParse({ ...draft, ...change }).success).toBe(
      false,
    );
  });
  it("does not accept a generic success as a create confirmation", () => {
    expect(mealCreateReceipt.safeParse({ success: true }).success).toBe(false);
    expect(mealCreateReceipt.parse({ mealId: "fixture_meal" })).toEqual({
      mealId: "fixture_meal",
    });
  });
});
