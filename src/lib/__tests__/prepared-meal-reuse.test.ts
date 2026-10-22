/** Authored/unrun. Navigation intents carry no canonical mutation authority. */
import {
  preparedReuseHref,
  preparedReuseIntent,
  resolvePreparedReuse,
} from "../prepared-meal-reuse";
import type { MealPrepSummary } from "../meal-batches";
const target = { sessionId: "prep-a", batchId: "batch-a" };
function session(): MealPrepSummary {
  return {
    id: "prep-a",
    prepared_on: "2026-10-22T00:00:00.000Z",
    prepared_at: "2026-10-22T12:00:00.000Z",
    next_prep_on: null,
    batches: [
      {
        id: "batch-a",
        name: "Synthetic rice",
        total_servings: 6,
        portions_complete: true,
        reserve_storage: "fridge",
        recipe_id: "recipe-a",
        cook_id: null,
        meals: [
          {
            id: "meal-a",
            date: "2026-10-23T00:00:00.000Z",
            meal_type: "dinner",
            servings: 3,
          },
        ],
        consumption: [
          {
            id: "eaten-a",
            meal_id: "meal-a",
            servings: 1,
            consumed_at: "2026-10-22T12:30:00.000Z",
          },
        ],
      },
    ],
  };
}
it("binds both exact opaque targets and refuses partial, conflicting or unsafe navigation", () => {
  const href = preparedReuseHref(target);
  expect(
    preparedReuseIntent(new URL(href, "https://example.invalid").searchParams),
  ).toEqual({ state: "target", target });
  for (const query of [
    "view=bulk&preparedSession=prep-a",
    "view=week&preparedSession=prep-a&preparedBatch=batch-a",
    "view=bulk&preparedSession=prep-a&preparedBatch=../other",
    "view=bulk&recipe=recipe-a&preparedSession=prep-a&preparedBatch=batch-a",
  ])
    expect(preparedReuseIntent(new URLSearchParams(query))).toEqual({
      state: "invalid",
    });
  expect(preparedReuseIntent(new URLSearchParams("view=bulk"))).toEqual({
    state: "none",
  });
});
it("uses canonical distinct eaten/planned/unplanned counts and never substitutes another dish", () => {
  const value = session();
  const ready = resolvePreparedReuse([value], target);
  expect(ready.state).toBe("ready");
  if (ready.state !== "ready") throw new Error("fixture");
  expect(ready.counts).toEqual({
    eaten: 1,
    planned: 2,
    remaining: 5,
    unplanned: 3,
  });
  expect(
    resolvePreparedReuse([value], { ...target, batchId: "other-batch" }).state,
  ).toBe("unavailable");
  expect(
    resolvePreparedReuse([value], {
      ...target,
      sessionId: "other-household-session",
    }).state,
  ).toBe("unavailable");
});
it("holds incomplete, older-server, unprepared and fully allocated records", () => {
  const value = session();
  value.batches[0].portions_complete = false;
  expect(resolvePreparedReuse([value], target).state).toBe("unavailable");
  delete value.batches[0].portions_complete;
  expect(resolvePreparedReuse([value], target).state).toBe("unavailable");
  value.batches[0].portions_complete = true;
  value.prepared_at = null;
  expect(resolvePreparedReuse([value], target).state).toBe("unprepared");
  value.prepared_at = "2026-10-22T12:00:00.000Z";
  value.batches[0].total_servings = 3;
  expect(resolvePreparedReuse([value], target).state).toBe("full");
});
