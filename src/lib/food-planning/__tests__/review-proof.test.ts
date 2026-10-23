/** Authored/unrun. Cryptographic command/owner/lease cases, no provider. */
jest.mock("../../auth", () => ({
  getJwtSecret: () => "synthetic-food-review-secret",
}));
import { reviewedFoodWrite } from "../apply-contract";
import {
  assertFoodReviewLease,
  issueFoodReviewSeal,
  readFoodReviewSeal,
} from "../review-proof";
const actor = {
  userId: "person-a",
  familyId: "family-a",
  role: "parent",
  generation: 3,
};
const now = new Date("2026-10-22T12:00:00Z");
const command = () => {
  const parsed = reviewedFoodWrite.parse({
    protocol: "herewoven.food-apply.v1",
    mode: "meals",
    reviewProof: "not-issued",
    sourceRequest: {
      plan: {
        timeZone: "UTC",
        slots: [
          {
            key: "dinner",
            date: "2026-10-22",
            mealType: "dinner",
            servings: 2,
            recipeId: "recipe-a",
          },
        ],
      },
    },
    meals: [
      {
        key: "dinner",
        input: {
          protocol: "herewoven.meal-create.v1",
          expected_user_id: actor.userId,
          expected_family_id: actor.familyId,
          issued_at: now.toISOString(),
          date: "2026-10-22",
          meal_type: "dinner",
          recipe_id: "recipe-a",
          servings: 2,
        },
      },
    ],
    groceries: [],
  });
  if (parsed.mode !== "meals") throw new Error("fixture");
  return parsed;
};
function signed() {
  const input = command();
  input.reviewProof = issueFoodReviewSeal(
    actor,
    input,
    "a".repeat(64),
    { privateFixtureLabel: "not-in-token" },
    now,
  );
  return input;
}
it("binds all command fields and exact owner without embedding private labels", () => {
  const input = signed(),
    payload = readFoodReviewSeal(actor, input);
  expect(payload.source).toBe("a".repeat(64));
  expect(
    Buffer.from(input.reviewProof.split(".")[1], "base64url").toString(),
  ).not.toContain("not-in-token");
  for (const changedActor of [
    { ...actor, userId: "person-b" },
    { ...actor, familyId: "family-b" },
    { ...actor, role: "teen" },
    { ...actor, generation: 4 },
  ])
    expect(() => readFoodReviewSeal(changedActor, input)).toThrow();
  const changes = [
    {
      ...input,
      meals: input.meals.map((row) => ({
        ...row,
        input: { ...row.input, servings: 3 },
      })),
    },
    {
      ...input,
      sourceRequest: {
        ...input.sourceRequest,
        plan: { ...input.sourceRequest.plan, priority: "quick" as const },
      },
    },
    {
      ...input,
      groceries: [
        { key: "dinner", listId: "list-a", ingredientIds: ["ingredient-a"] },
      ],
    },
  ];
  for (const changed of changes)
    expect(() =>
      readFoodReviewSeal(actor, reviewedFoodWrite.parse(changed)),
    ).toThrow();
});
it("refuses altered/noncanonical seals and a different signing key", () => {
  const input = signed();
  for (const reviewProof of [
    input.reviewProof.replace(/.$/, (value) => (value === "0" ? "1" : "0")),
    `${input.reviewProof}.extra`,
    input.reviewProof.replace("fpr1", "asb1"),
    "x".repeat(4097),
  ])
    expect(() =>
      readFoodReviewSeal(actor, { ...input, reviewProof }),
    ).toThrow();
  expect(() => readFoodReviewSeal(actor, input, "different-key")).toThrow();
});
it("preserves the original sixty-second lease and separates decoding from expiry", () => {
  const input = signed(),
    payload = readFoodReviewSeal(actor, input);
  expect(() => assertFoodReviewLease(payload, +now)).not.toThrow();
  expect(() => assertFoodReviewLease(payload, +now + 59999)).not.toThrow();
  for (const clock of [+now + 60000, +now - 1001, NaN])
    expect(() => assertFoodReviewLease(payload, clock)).toThrow();
  // Reading an expired seal is allowed only so completed receipt paths can
  // remain independent of a current source; new effects must call lease check.
  expect(readFoodReviewSeal(actor, input)).toEqual(payload);
});
