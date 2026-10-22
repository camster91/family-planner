/** Fabricated source-only fixtures. */
import {
  PREP_RECOVERY,
  prepCommand,
  prepContext,
  prepEntry,
} from "../contract";
export const now = new Date("2026-10-22T12:00:00.000Z");
export const actor = {
  userId: "parent-a",
  familyId: "family-a",
  role: "parent",
  generation: 2,
};
export const command = () =>
  prepCommand.parse({
    protocol: PREP_RECOVERY,
    kind: "action",
    role: actor.role,
    generation: actor.generation,
    issuedAt: now.toISOString(),
    input: {
      expected_user_id: actor.userId,
      expected_family_id: actor.familyId,
      action: "allocate",
      require_prepared: true,
      batch_id: "batch-a",
      meals: [{ date: "2026-10-23", meal_type: "dinner", servings: 2 }],
    },
  });
export const context = () =>
  prepContext.parse({
    contract: PREP_RECOVERY,
    enabled: true,
    userId: actor.userId,
    familyId: actor.familyId,
    role: actor.role,
    owner: {
      kind: "person",
      ownerId: actor.userId,
      generation: actor.generation,
      householdScope: "a".repeat(64),
      scope: "b".repeat(64),
    },
  });
export const entry = () =>
  prepEntry.parse({
    kind: "meal-prep",
    key: "prep_fixture_request_1234",
    body: JSON.stringify(command()),
  });
export const receipt = () => ({ batchId: "batch-a", mealIds: ["meal-a"] });
