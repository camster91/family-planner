/** Authored/unrun. Versioned semantic constraints; not nutritional/product scores. */
import { evaluateFoodAiProposal } from "../ai-evaluation";
import {
  copyFoodAiChoices,
  newFoodDraft,
  foodDraftQuery,
  foodEditorDraft,
} from "../editor";
import { FOOD_AI, foodAiSuggestion } from "../ai-contract";
import { aiFixture } from "./ai-fixture";
function suggestion() {
  const { original, proposal } = aiFixture();
  return foodAiSuggestion.parse({
    protocol: FOOD_AI,
    original,
    proposal,
    evidence: [
      {
        key: "dinner",
        recipeId: "recipe-b",
        ref: `frc1_${"a".repeat(64)}`,
        label: "Synthetic b",
        source: "household-recipe",
      },
    ],
    evaluation: evaluateFoodAiProposal(original, proposal),
  });
}
afterEach(() => jest.useRealTimers());
it("scores canonical compliance without claiming preference or health correctness", () => {
  const result = suggestion();
  expect(result.evaluation).toMatchObject({
    groundingScore: 100,
    changedRecipes: 1,
    preferenceAssessment: "human-review",
  });
  expect(result.proposal.plan.stockReserved).toBe(false);
  expect(result.proposal.plan.writesPerformed).toBe(false);
});
it("refuses changed owner, quantities, query dates, pins and recipes absent from the issued catalog", () => {
  for (const change of [
    "owner",
    "quantity",
    "date",
    "pin",
    "invented",
  ] as const) {
    const { original, proposal } = aiFixture();
    if (change === "owner")
      proposal.owner = { ...proposal.owner, familyId: "other-family" };
    if (change === "quantity")
      proposal.sourceRequest.plan.slots[0].servings = 8;
    if (change === "date")
      proposal.sourceRequest.plan.slots[0].date = "2026-10-23";
    if (change === "pin")
      original.sourceRequest.plan.slots[0].recipeId = "recipe-a";
    if (change === "invented") {
      proposal.sourceRequest.plan.slots[0].recipeId = "invented";
      proposal.plan.slots[0].choice!.recipeId = "invented";
    }
    expect(() => evaluateFoodAiProposal(original, proposal)).toThrow();
  }
});
it("copies only selected IDs, retains editable intent and clears stale groceries, without accepting old replies", () => {
  const reply = suggestion();
  jest.useFakeTimers().setSystemTime(new Date(reply.original.generatedAt));
  const draft = newFoodDraft("2026-10-22", "UTC");
  draft.slots[0].key = "dinner";
  draft.aiPreference = "Synthetic preference";
  draft.slots[0].notes = "Keep this note";
  draft.groceries = [
    { key: "dinner", listId: "list-a", ingredientIds: ["ingredient-a"] },
  ];
  const selected = copyFoodAiChoices(draft, reply);
  expect(selected.slots[0]).toMatchObject({
    recipeId: "recipe-b",
    notes: "Keep this note",
  });
  expect(selected.aiPreference).toBe(draft.aiPreference);
  expect(selected.groceries).toEqual([]);
  expect(draft.slots[0].recipeId).toBe("");
  expect(foodDraftQuery(selected)).toEqual(reply.proposal.sourceRequest);
  expect(() =>
    copyFoodAiChoices(
      { ...draft, slots: [{ ...draft.slots[0], servings: "3" }] },
      reply,
    ),
  ).toThrow();
  jest.setSystemTime(new Date(reply.original.expiresAt));
  expect(() => copyFoodAiChoices(draft, reply)).toThrow();
});
it("adopts old raw documents with an empty preference; preference never enters canonical meal input", () => {
  const { aiPreference: omitted, ...old } = newFoodDraft("2026-10-22", "UTC");
  void omitted;
  const restored = foodEditorDraft.parse(old);
  expect(restored.aiPreference).toBe("");
  restored.aiPreference = "Synthetic private preference";
  expect(JSON.stringify(foodDraftQuery(restored))).not.toContain(
    restored.aiPreference,
  );
});
