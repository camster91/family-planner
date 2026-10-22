/** Explicit metered provider ranking, canonical reconstruction, no domain effects. */
import type { PrismaClient } from "@prisma/client";
import { normalizeFeatures } from "../features";
import { canonicalRequestJson } from "../idempotency-request-json";
import {
  structuredFoodPlanReply,
  resolveCaptureConfig,
  type CaptureConfig,
} from "../capture";
import type { AiUsageJob } from "../ai-usage-server";
import {
  previewFoodPlan,
  previewFoodPlanInTx,
  type FoodPlanActor,
} from "./server";
import { foodPreviewRequest } from "./contract";
import { foodPreviewView } from "./view-contract";
import { FOOD_AI, foodAiRequest, foodAiSuggestion } from "./ai-contract";
import {
  buildFoodAiCatalog,
  resolveFoodAiChoices,
  foodAiLeaseCurrent,
  FoodAiRefused,
} from "./ai-catalog";
import { foodAiEnabled } from "./ai-gates";
import { evaluateFoodAiProposal } from "./ai-evaluation";
export const foodAiFamilySelect = {
  features: true,
  capture_ai_key_enc: true,
  capture_ai_base_url: true,
  capture_ai_model: true,
} as const;
export async function suggestFoodPlan(
  db: Pick<PrismaClient, "$transaction">,
  actor: FoodPlanActor,
  raw: unknown,
  config: CaptureConfig,
  features: ReturnType<typeof normalizeFeatures>,
  meter: Exclude<AiUsageJob, undefined>,
  renewAuthentication: () => Promise<boolean>,
) {
  if (!foodAiEnabled()) throw new FoodAiRefused("AI_SOURCE_CHANGED");
  const input = foodAiRequest.parse(raw);
  const original = foodPreviewView.parse(
    await previewFoodPlan(db, actor, input.sourceRequest),
  );
  if (!foodAiLeaseCurrent(original))
    throw new FoodAiRefused("AI_SOURCE_CHANGED");
  if (Buffer.byteLength(JSON.stringify(original), "utf8") > 262144)
    throw new FoodAiRefused("AI_SOURCE_LIMIT");
  const catalog = buildFoodAiCatalog(original);
  if (
    !foodAiEnabled() ||
    !foodAiLeaseCurrent(original) ||
    !(await renewAuthentication())
  )
    throw new FoodAiRefused("AI_SOURCE_CHANGED");
  const providerReply = await structuredFoodPlanReply(
    catalog.projection,
    input.preference,
    config,
    meter.observer,
  );
  if (
    !foodAiEnabled() ||
    !foodAiLeaseCurrent(original) ||
    !(await renewAuthentication()) ||
    !(await meter.replyAllowed())
  )
    throw new FoodAiRefused("AI_SOURCE_CHANGED");
  const evidence = resolveFoodAiChoices(providerReply, catalog, original);
  const chosen = foodPreviewRequest.parse({
    ...original.sourceRequest,
    plan: {
      ...original.sourceRequest.plan,
      slots: original.sourceRequest.plan.slots.map((slot) => ({
        ...slot,
        recipeId: evidence.find((row) => row.key === slot.key)!.recipeId,
      })),
    },
  });
  const proposal = await db.$transaction(
    async (tx) => {
      // Anchor the original lease and source window; provider latency cannot
      // refresh evidence age. Both requests read the same current RR snapshot.
      const renewed = foodPreviewView.parse(
        await previewFoodPlanInTx(
          tx,
          actor,
          original.sourceRequest,
          new Date(original.generatedAt),
        ),
      );
      if (
        renewed.snapshotRevision !== original.snapshotRevision ||
        canonicalRequestJson(renewed.plan) !==
          canonicalRequestJson(original.plan)
      )
        throw new FoodAiRefused("AI_SOURCE_CHANGED");
      const family = await tx.family.findUnique({
        where: { id: actor.familyId },
        select: foodAiFamilySelect,
      });
      const currentConfig = resolveCaptureConfig(family);
      // Configuration may contain credentials. Compare only in memory; never
      // return, persist or log either config or provider reply/prompt content.
      if (
        !family ||
        !currentConfig ||
        canonicalRequestJson(currentConfig) !== canonicalRequestJson(config) ||
        canonicalRequestJson(normalizeFeatures(family.features)) !==
          canonicalRequestJson(features)
      )
        throw new FoodAiRefused("AI_SOURCE_CHANGED");
      return foodPreviewView.parse(
        await previewFoodPlanInTx(
          tx,
          actor,
          chosen,
          new Date(original.generatedAt),
        ),
      );
    },
    { isolationLevel: "RepeatableRead", timeout: 15000 },
  );
  const evaluation = evaluateFoodAiProposal(original, proposal);
  const result = foodAiSuggestion.parse({
    protocol: FOOD_AI,
    original,
    proposal,
    evidence,
    evaluation,
  });
  if (
    !foodAiEnabled() ||
    !foodAiLeaseCurrent(original) ||
    !(await renewAuthentication()) ||
    !(await meter.replyAllowed())
  )
    throw new FoodAiRefused("AI_SOURCE_CHANGED");
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > 655360)
    throw new FoodAiRefused("AI_SOURCE_LIMIT");
  return result;
}
