import { describeMeal } from "../meal-description";
it("suggests explicit free-text plan fields without a recipe/cook identity or stock operation", () => {
  expect(
    describeMeal("Plan tacos for dinner on 2027-10-21 for 4 people"),
  ).toEqual({
    kind: "review",
    draft: {
      recipe_name: "tacos",
      date: "2027-10-21",
      meal_type: "dinner",
      servings: 4,
    },
  });
  expect(describeMeal("tacos")).toEqual({
    kind: "review",
    draft: { recipe_name: "tacos" },
  });
  expect(describeMeal("lunch: mac and cheese for 2 servings")).toEqual({
    kind: "review",
    draft: { recipe_name: "mac and cheese", meal_type: "lunch", servings: 2 },
  });
});
it("supports Spanish explicit day/slot/portions through the same canonical field vocabulary", () => {
  expect(
    describeMeal("Planifica tacos para la cena el 2027-10-21 para 4 personas"),
  ).toEqual({
    kind: "review",
    draft: {
      recipe_name: "tacos",
      date: "2027-10-21",
      meal_type: "dinner",
      servings: 4,
    },
  });
});
it.each([
  "tacos tomorrow",
  "tacos on 2027-02-29",
  "tacos on 10/21/2027",
  "tacos on October 21",
  "tacos on 21 October",
  "tacos at 6 pm",
  "tacos para mañana",
  "tacos for 4",
  "tacos for two people",
  "tacos for 0 people",
  "tacos for 101 people",
  "tacos for 2 people for 3 people",
  "tacos for lunch for dinner",
  "tacos on 2027-10-21 on 2027-10-22",
  "tacos; salad",
  "I ate tacos on 2027-10-21",
])("leaves unclear/multiple meal descriptions manual: %s", (input) => {
  expect(describeMeal(input)).toMatchObject({ kind: "manual" });
});
it("does not split a legitimate meal name or guess missing values", () => {
  expect(describeMeal("chicken on toast")).toEqual({
    kind: "review",
    draft: { recipe_name: "chicken on toast" },
  });
  expect(describeMeal("a".repeat(201))).toMatchObject({
    kind: "manual",
    reason: "too_long",
  });
  expect(describeMeal("a".repeat(2001))).toMatchObject({
    kind: "manual",
    reason: "too_long",
  });
});
