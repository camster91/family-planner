/** Authored/unrun. Raw intent conversion must match canonical form submissions. */
import { prepDraftInput } from "../draft-input";
import { prepDraft } from "../draft-contract";
import { context } from "./fixture";
it("preserves incomplete fields locally but refuses them for a canonical save", () => {
  const raw = prepDraft.parse({
    kind: "create",
    day: "",
    nextDay: "",
    dishes: [
      {
        name: "",
        portions: "",
        recipe: null,
        cookId: "",
        storage: "fridge",
        meals: [],
      },
    ],
    step: 0,
    selectedDish: 0,
  });
  expect(() => prepDraftInput(raw, context())).toThrow();
});
it("binds prepared-only allocation and next-prep comparison to the raw owned draft", () => {
  const base = {
    kind: "action",
    sessionId: "prep-a",
    batchId: "batch-a",
    requirePrepared: true,
    mealId: "",
    servings: "1",
    meals: [{ date: "2026-10-23", meal_type: "dinner", servings: "2" }],
    nextDay: "",
    expectedNext: null,
  };
  expect(
    prepDraftInput(prepDraft.parse({ ...base, action: "allocate" }), context()),
  ).toMatchObject({
    expected_user_id: "parent-a",
    expected_family_id: "family-a",
    action: "allocate",
    require_prepared: true,
    batch_id: "batch-a",
    meals: [{ servings: 2 }],
  });
  expect(
    prepDraftInput(
      prepDraft.parse({
        ...base,
        requirePrepared: false,
        action: "next-prep",
        nextDay: "2026-10-29",
        expectedNext: "2026-10-25",
      }),
      context(),
    ),
  ).toMatchObject({
    action: "next-prep",
    session_id: "prep-a",
    next_prep_on: "2026-10-29",
    expected_next_prep_on: "2026-10-25",
  });
});
