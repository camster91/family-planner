/** Browser-safe AI proposals. They are read suggestions, never write proofs. */
import { z } from "zod";
import { memberIdentityIdSchema as id } from "../member-subject-contract";
import { foodPreviewRequest } from "./contract";
import { foodPreviewView } from "./view-contract";
export const FOOD_AI = "herewoven.food-ai.v1";
export const FOOD_AI_EVALUATION = "herewoven.food-ai-evaluation.v1";
export const foodAiRequest = z
  .object({
    sourceRequest: foodPreviewRequest,
    preference: z.string().trim().max(1000).default(""),
  })
  .strict();
export const foodAiReference = z.string().regex(/^frc1_[a-f0-9]{64}$/);
export const foodAiSlotReference = z.string().regex(/^fsl1_[a-f0-9]{64}$/);
export const foodAiProviderReply = z
  .object({
    protocol: z.literal(FOOD_AI),
    choices: z
      .array(
        z
          .object({ slot: foodAiSlotReference, recipe: foodAiReference })
          .strict(),
      )
      .min(1)
      .max(14),
  })
  .strict();
export const foodAiEvaluation = z
  .object({
    version: z.literal(FOOD_AI_EVALUATION),
    // Compliance with issued references/current canonical sources only. This is
    // not a recipe-health, safety, dietary or overall product-quality rating.
    groundingScore: z.literal(100),
    reviewablePercent: z.number().int().min(0).max(100),
    heldSlots: z.number().int().min(0).max(14),
    unknownIngredientLines: z.number().int().min(0).max(1400),
    unknownDurationSlots: z.number().int().min(0).max(14),
    changedRecipes: z.number().int().min(0).max(14),
    preferenceAssessment: z.literal("human-review"),
  })
  .strict();
export const foodAiFeedbackTicket = z
  .string()
  .regex(/^faf1\.[0-9]{13}\.[a-f0-9-]{36}\.[a-f0-9]{64}$/);
export const foodAiFeedbackInput = z
  .object({
    ticket: foodAiFeedbackTicket,
    decision: z.enum(["used", "kept"]),
  })
  .strict();
export const foodAiFeedbackReply = z
  .object({
    protocol: z.literal("herewoven.food-ai-feedback.v1"),
    state: z.enum(["recorded", "skipped"]),
  })
  .strict();
export const foodAiSuggestion = z
  .object({
    protocol: z.literal(FOOD_AI),
    feedbackTicket: foodAiFeedbackTicket.nullable().default(null),
    original: foodPreviewView,
    proposal: foodPreviewView,
    evidence: z
      .array(
        z
          .object({
            key: id,
            recipeId: id,
            ref: foodAiReference,
            label: z.string().min(1).max(1000),
            source: z.literal("household-recipe"),
          })
          .strict(),
      )
      .min(1)
      .max(14),
    evaluation: foodAiEvaluation,
  })
  .strict()
  .refine((value) => {
    const { original, proposal } = value;
    return (
      original.owner.userId === proposal.owner.userId &&
      original.owner.familyId === proposal.owner.familyId &&
      original.owner.role === proposal.owner.role &&
      original.owner.generation === proposal.owner.generation &&
      original.generatedAt === proposal.generatedAt &&
      original.expiresAt === proposal.expiresAt &&
      original.plan.slots.length === proposal.plan.slots.length &&
      value.evidence.length === proposal.plan.slots.length &&
      new Set(value.evidence.map((row) => row.key)).size ===
        value.evidence.length &&
      new Set(value.evidence.map((row) => row.ref)).size ===
        value.evidence.length &&
      proposal.plan.slots.every(
        (row) =>
          !!row.choice &&
          value.evidence.some(
            (evidence) =>
              evidence.key === row.key &&
              evidence.recipeId === row.choice!.recipeId &&
              evidence.label === row.choice!.title,
          ),
      )
    );
  });
export type FoodAiSuggestion = z.infer<typeof foodAiSuggestion>;
