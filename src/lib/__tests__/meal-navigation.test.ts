/** Authored for the deferred QA pass; not executed during source recovery. */
import { mealDayHref } from "../meal-navigation";

it("retains the viewed calendar day and existing planner context", () => {
  expect(mealDayHref("/dashboard/meals?view=bulk&recipe=fixture#plan", "2026-11-02"))
    .toBe("/dashboard/meals?view=bulk&recipe=fixture&start=2026-11-02#plan");
});
it("replaces an older start without resetting unrelated intent", () => {
  expect(mealDayHref("/dashboard/meals?start=2026-10-01&recipe=fixture", "2026-11-02"))
    .toBe("/dashboard/meals?start=2026-11-02&recipe=fixture");
});
it.each([null, undefined, "", "2026-02-30", "not-a-date"])("does not guess a day for %s", day => {
  expect(mealDayHref("/dashboard/meals?view=week", day)).toBe("/dashboard/meals?view=week");
});
it("leaves unavailable and unrelated destinations alone", () => {
  expect(mealDayHref(null, "2026-11-02")).toBeNull();
  expect(mealDayHref("/dashboard/recipes", "2026-11-02")).toBe("/dashboard/recipes");
  expect(mealDayHref("https://example.test/dashboard/meals", "2026-11-02"))
    .toBe("https://example.test/dashboard/meals");
});
