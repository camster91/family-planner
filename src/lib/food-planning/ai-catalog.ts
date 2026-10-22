/** Ephemeral server mapping. The provider never receives canonical IDs or URLs. */
import { createHmac } from "node:crypto";
import { getJwtSecret } from "../auth";
import { canonicalRequestJson } from "../idempotency-request-json";
export { foodAiLeaseCurrent } from "./ai-evaluation";
import { foodPreviewView, type FoodPreviewView } from "./view-contract";
import { FOOD_AI, foodAiProviderReply } from "./ai-contract";
export class FoodAiRefused extends Error {
  constructor(
    public readonly code:
      | "AI_SELECTION_INVALID"
      | "AI_SOURCE_HELD"
      | "AI_SOURCE_CHANGED"
      | "AI_SOURCE_LIMIT" = "AI_SELECTION_INVALID",
  ) {
    super(code);
  }
}
const digest = (key: string, value: unknown) =>
  createHmac("sha256", key).update(canonicalRequestJson(value)).digest("hex");
export function buildFoodAiCatalog(raw: FoodPreviewView, key = getJwtSecret()) {
  const view = foodPreviewView.parse(raw);
  const binding = [
    "food-ai.source.v1",
    view.owner,
    view.snapshotRevision,
    view.generatedAt,
  ];
  const mapping = view.plan.slots.map((row) => {
    const slot = view.sourceRequest.plan.slots.find(
      (entry) => entry.key === row.key,
    )!;
    if (
      !slot ||
      !row.choice ||
      row.holds.some((hold) =>
        [
          "slot-occupied",
          "source-incomplete",
          "commitments-unresolved",
        ].includes(hold),
      )
    )
      throw new FoodAiRefused("AI_SOURCE_HELD");
    const available = slot.recipeId
      ? [row.choice]
      : [row.choice, ...row.alternatives];
    if (slot.recipeId && row.choice.recipeId !== slot.recipeId)
      throw new FoodAiRefused("AI_SOURCE_HELD");
    if (
      new Set(available.map((candidate) => candidate.recipeId)).size !==
      available.length
    )
      throw new FoodAiRefused("AI_SOURCE_HELD");
    return {
      key: row.key,
      slot,
      ref: `fsl1_${digest(key, [...binding, "slot", row.key])}`,
      choices: available.map((candidate) => ({
        candidate,
        ref: `frc1_${digest(key, [...binding, "recipe", row.key, candidate.recipeId])}`,
      })),
    };
  });
  if (
    !mapping.length ||
    new Set(mapping.map((row) => row.ref)).size !== mapping.length
  )
    throw new FoodAiRefused();
  const projection = {
    protocol: FOOD_AI,
    observedAt: view.generatedAt,
    expiresAt: view.expiresAt,
    request: {
      mode: view.sourceRequest.plan.mode,
      priority: view.sourceRequest.plan.priority,
      repeatRecipes: view.sourceRequest.plan.repeatRecipes,
    },
    slots: mapping.map((row) => ({
      ref: row.ref,
      date: row.slot.date,
      mealType: row.slot.mealType,
      servings: row.slot.servings,
      pinned: !!row.slot.recipeId,
      choices: row.choices.map(({ candidate, ref }) => ({
        ref,
        identity: `fri1_${digest(key, [...binding, "recipe-identity", candidate.recipeId])}`,
        title: candidate.title,
        baseServings: candidate.baseServings,
        servings: candidate.servings,
        authoredMinutes: candidate.authoredMinutes,
        totalMinutes: candidate.totalMinutes,
        time: candidate.time,
        calendar: candidate.schedule
          ? {
              state: candidate.schedule.state,
              occupiedMinutes: candidate.schedule.occupiedMinutes,
            }
          : null,
        useSoonCount: candidate.useSoonCount,
        coveredCount: candidate.coveredCount,
        shortfallCount: candidate.shortfallCount,
        checkCount: candidate.checkCount,
        ingredients: candidate.ingredients.map((line) => ({
          name: line.name,
          unit: line.unit,
          required: line.required,
          recordedAvailable: line.recordedAvailable,
          shortfall: line.shortfall,
          state: line.state,
          match: line.match,
          useSoon: line.useSoon,
        })),
      })),
    })),
  };
  if (Buffer.byteLength(JSON.stringify(projection), "utf8") > 65536)
    throw new FoodAiRefused("AI_SOURCE_LIMIT");
  return { mapping, projection };
}
export type FoodAiCatalog = ReturnType<typeof buildFoodAiCatalog>;
export function resolveFoodAiChoices(
  raw: unknown,
  catalog: FoodAiCatalog,
  source: FoodPreviewView,
) {
  const parsed = foodAiProviderReply.safeParse(raw);
  if (!parsed.success) throw new FoodAiRefused();
  const rows = parsed.data.choices;
  if (
    rows.length !== catalog.mapping.length ||
    new Set(rows.map((row) => row.slot)).size !== rows.length
  )
    throw new FoodAiRefused();
  const resolved = catalog.mapping.map((entry) => {
    const selection = rows.find((row) => row.slot === entry.ref),
      choice = entry.choices.find((row) => row.ref === selection?.recipe);
    if (!choice) throw new FoodAiRefused();
    return {
      key: entry.key,
      recipeId: choice.candidate.recipeId,
      ref: choice.ref,
      label: choice.candidate.title,
      source: "household-recipe" as const,
    };
  });
  if (!source.sourceRequest.plan.repeatRecipes) {
    for (const id of new Set(resolved.map((row) => row.recipeId))) {
      const pinned = source.sourceRequest.plan.slots.filter(
        (row) => row.recipeId === id,
      ).length;
      if (
        resolved.filter((row) => row.recipeId === id).length >
        Math.max(1, pinned)
      )
        throw new FoodAiRefused();
    }
  }
  return resolved;
}
