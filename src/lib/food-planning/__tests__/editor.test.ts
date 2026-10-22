/** Authored/unrun. Partial drafts are never network commands. */
import {
  foodEditorDraft,
  foodDraftQuery,
  foodDraftCommand,
  newFoodDraft,
} from "../editor";
import { foodRecoveryInput, FOOD_RECOVERY } from "../recovery-contract";
import { makePreview } from "./view-fixture";
import { context } from "./recovery-fixture";
function draft() {
  const value = newFoodDraft("2026-10-22", "UTC");
  value.slots[0].key = "dinner";
  value.slots[0].recipeId = "recipe-a";
  return value;
}
it("retains unfinished numeric/date fields but refuses them at the source-read boundary", () => {
  const value = draft();
  value.slots[0].servings = "";
  value.slots[0].date = "";
  expect(foodEditorDraft.safeParse(value).success).toBe(true);
  expect(() => foodDraftQuery(value)).toThrow();
  expect(
    foodRecoveryInput.safeParse({
      contract: FOOD_RECOVERY,
      entry: {
        kind: "local-food-draft",
        key: "local_food_fixture_123",
        body: JSON.stringify({
          userId: "parent-a",
          familyId: "family-a",
          draft: value,
        }),
      },
    }).success,
  ).toBe(false);
});
it("constructs only exact reviewed recipe/date/portion commands, retaining actual notes and cook selection", () => {
  const value = draft();
  value.slots[0].notes = "Fixture note";
  const command = foodDraftCommand(value, makePreview(), context());
  if (command.mode !== "meals") throw new Error("fixture");
  expect(command.meals[0].input).toMatchObject({
    recipe_id: "recipe-a",
    servings: 2,
    notes: "Fixture note",
    cook_id: null,
  });
  value.slots[0].date = "2026-10-23";
  expect(() => foodDraftCommand(value, makePreview(), context())).toThrow();
});
it("requires a real DST wall time and an explicit choice for repeated clocks", () => {
  const value = draft();
  value.timeZone = "America/Toronto";
  value.slots[0].date = "2026-11-01";
  value.slots[0].timing = {
    ...value.slots[0].timing,
    enabled: true,
    start: "2026-11-01T01:15",
    end: "2026-11-01T02:30",
  };
  expect(() => foodDraftQuery(value)).toThrow();
  value.slots[0].timing.startChoice = "2026-11-01T05:15:00.000Z";
  expect(foodDraftQuery(value).plan.slots[0].timing!.start).toBe(
    "2026-11-01T05:15:00.000Z",
  );
  value.slots[0].date = "2026-03-08";
  value.slots[0].timing.start = "2026-03-08T02:15";
  expect(() => foodDraftQuery(value)).toThrow();
});

it("preserves legacy allocation cook intent and distinguishes inherited cook from explicit none", () => {
  const value = draft();
  value.mode = "prep";
  value.slots[0].cookId = "parent-a";
  value.slots[0].allocations = [
    {
      date: "2026-10-22",
      mealType: "dinner",
      servings: "1",
      cookId: "",
      notes: "",
      inheritCook: true,
    },
    {
      date: "2026-10-23",
      mealType: "lunch",
      servings: "1",
      cookId: "",
      notes: "",
      inheritCook: false,
    },
  ];
  const preview = { ...makePreview(), sourceRequest: foodDraftQuery(value) };
  const command = foodDraftCommand(value, preview, context());
  if (command.mode !== "prep") throw new Error("fixture");
  expect(command.input.dishes[0].meals![0].cook_id).toBeUndefined();
  expect(command.input.dishes[0].meals![1].cook_id).toBeNull();
  const legacy = {
    ...value,
    slots: [
      {
        ...value.slots[0],
        allocations: [
          {
            date: "2026-10-22",
            mealType: "dinner",
            servings: "",
            cookId: "",
            notes: "",
          },
        ],
      },
    ],
  };
  expect(
    foodEditorDraft.parse(legacy).slots[0].allocations[0].inheritCook,
  ).toBe(false);
  expect(() =>
    foodDraftCommand(foodEditorDraft.parse(legacy), preview, context()),
  ).toThrow();
});
