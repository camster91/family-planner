/** Versioned semantic grounding/feasibility metrics. No health/preference score. */
import { canonicalRequestJson } from "../idempotency-request-json";
import { FOOD_AI_EVALUATION, foodAiEvaluation } from "./ai-contract";
import { foodPreviewView, type FoodPreviewView } from "./view-contract";
import { dayKeyFor } from "../local-day-key";
export function evaluateFoodAiProposal(
  original: FoodPreviewView,
  proposal: FoodPreviewView,
) {
  original = foodPreviewView.parse(original);
  proposal = foodPreviewView.parse(proposal);
  for (const view of [original, proposal]) {
    if (
      view.recipeScope !==
        (view.sourceRequest.recipeIds ? "selected" : "library") ||
      view.plan.slots.length !== view.sourceRequest.plan.slots.length ||
      view.plan.slots.some((row) => {
        const slot = view.sourceRequest.plan.slots.find(
          (entry) => entry.key === row.key,
        );
        return (
          !slot ||
          [row.choice, ...row.alternatives].some(
            (candidate) =>
              candidate &&
              (candidate.servings !== slot.servings ||
                (view.sourceRequest.recipeIds &&
                  !view.sourceRequest.recipeIds.includes(candidate.recipeId))),
          ) ||
          (!!slot.recipeId && row.choice?.recipeId !== slot.recipeId)
        );
      })
    )
      throw new Error("AI proposal source shape changed");
  }
  const expected = {
    ...original.sourceRequest,
    plan: {
      ...original.sourceRequest.plan,
      slots: original.sourceRequest.plan.slots.map((slot) => ({
        ...slot,
        recipeId: proposal.sourceRequest.plan.slots.find(
          (row) => row.key === slot.key,
        )?.recipeId,
      })),
    },
  };
  if (
    canonicalRequestJson(expected) !==
      canonicalRequestJson(proposal.sourceRequest) ||
    original.generatedAt !== proposal.generatedAt ||
    original.expiresAt !== proposal.expiresAt ||
    canonicalRequestJson(original.owner) !==
      canonicalRequestJson(proposal.owner) ||
    proposal.plan.slots.length !== original.plan.slots.length ||
    proposal.plan.slots.some(
      (row) =>
        !row.choice ||
        row.choice.recipeId !==
          proposal.sourceRequest.plan.slots.find((slot) => slot.key === row.key)
            ?.recipeId,
    ) ||
    original.sourceRequest.plan.slots.some(
      (row) =>
        row.recipeId &&
        row.recipeId !==
          proposal.sourceRequest.plan.slots.find((slot) => slot.key === row.key)
            ?.recipeId,
    )
  )
    throw new Error("AI proposal changed canonical intent");
  for (const row of proposal.plan.slots) {
    const source = original.plan.slots.find((slot) => slot.key === row.key);
    if (
      !source ||
      ![source.choice, ...source.alternatives].some(
        (candidate) => candidate?.recipeId === row.choice!.recipeId,
      )
    )
      throw new Error("AI proposal invented a recipe");
  }
  if (!original.sourceRequest.plan.repeatRecipes) {
    for (const id of new Set(
      proposal.plan.slots.map((row) => row.choice!.recipeId),
    )) {
      const pins = original.sourceRequest.plan.slots.filter(
        (row) => row.recipeId === id,
      ).length;
      if (
        proposal.plan.slots.filter((row) => row.choice!.recipeId === id)
          .length > Math.max(1, pins)
      )
        throw new Error("AI proposal introduced a repeated recipe");
    }
  }
  const heldSlots = proposal.plan.slots.filter(
    (row) => row.holds.length > 0,
  ).length;
  return foodAiEvaluation.parse({
    version: FOOD_AI_EVALUATION,
    groundingScore: 100,
    reviewablePercent: Math.round(
      ((proposal.plan.slots.length - heldSlots) / proposal.plan.slots.length) *
        100,
    ),
    heldSlots,
    unknownIngredientLines: proposal.plan.slots.reduce(
      (sum, row) =>
        sum +
        row.choice!.ingredients.filter((line) => line.state === "check").length,
      0,
    ),
    unknownDurationSlots: proposal.plan.slots.filter(
      (row) => row.choice!.totalMinutes === null,
    ).length,
    changedRecipes: proposal.plan.slots.filter(
      (row) =>
        row.choice!.recipeId !==
        original.plan.slots.find((entry) => entry.key === row.key)?.choice
          ?.recipeId,
    ).length,
    preferenceAssessment: "human-review",
  });
}

/** Read lease only, never an action proof. Shared with the browser to reject
 * expired provider results before rendering or copying choices into a draft. */
export function foodAiLeaseCurrent(
  view: Pick<FoodPreviewView, "generatedAt" | "expiresAt" | "sourceRequest">,
  now = Date.now(),
) {
  const start = Date.parse(view.generatedAt),
    end = Date.parse(view.expiresAt);
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end - start !== 60000 ||
    now < start ||
    now >= end
  )
    return false;
  const localDay = dayKeyFor({
    kind: "tz",
    timeZone: view.sourceRequest.plan.timeZone,
  });
  return localDay(new Date(start)) === localDay(new Date(now));
}
