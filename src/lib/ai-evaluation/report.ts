/** Content-free versioned evaluation results. A fixture score is not AI quality. */
import { z } from "zod";
export const AI_CONTRACT_EVALUATION =
  "herewoven.ai-contract-evaluation.2026-10-22.v1";
export const aiEvaluationCase = z.enum([
  "use-soon-expiry",
  "missing-grocery-quantity",
  "stock-counted-once",
  "continuous-departure-window",
  "scaled-duration-unknown",
  "unresolved-commitment",
  "invented-reference",
  "cross-household-reference",
  "changed-source-revision",
  "deleted-reference",
  "clarification-contract",
  "injected-action",
  "child-action-refusal",
  "malformed-food-output",
  "incomplete-event-intent",
]);
export const aiEvaluationDimension = z.enum([
  "canonical-math",
  "grounding",
  "scope",
  "freshness",
  "schema",
  "clarification",
]);
export type AiEvaluationCase = z.infer<typeof aiEvaluationCase>;
export type AiEvaluationDimension = z.infer<typeof aiEvaluationDimension>;
const dimensions: Record<AiEvaluationCase, AiEvaluationDimension> = {
  "use-soon-expiry": "canonical-math",
  "missing-grocery-quantity": "canonical-math",
  "stock-counted-once": "canonical-math",
  "continuous-departure-window": "canonical-math",
  "scaled-duration-unknown": "grounding",
  "unresolved-commitment": "grounding",
  "invented-reference": "grounding",
  "cross-household-reference": "scope",
  "changed-source-revision": "freshness",
  "deleted-reference": "grounding",
  "clarification-contract": "clarification",
  "injected-action": "schema",
  "child-action-refusal": "scope",
  "malformed-food-output": "schema",
  "incomplete-event-intent": "schema",
};
const observation = z
  .object({
    caseId: aiEvaluationCase,
    dimension: aiEvaluationDimension,
    outcome: z.enum(["pass", "fail", "error"]),
  })
  .strict()
  .refine((entry) => entry.dimension === dimensions[entry.caseId]);
export const aiContractReport = z
  .object({
    protocol: z.literal(AI_CONTRACT_EVALUATION),
    fixtureVersion: z.literal("household-ai-contracts.2026-10-22.v1"),
    measured: z.literal("offline-canonical-contracts"),
    requiredCases: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    passed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    errors: z.number().int().nonnegative(),
    missing: z.array(aiEvaluationCase),
    accuracyPercent: z.number().min(0).max(100).nullable(),
    observations: z.array(observation).max(aiEvaluationCase.options.length),
    providerAnswerAccuracy: z.null(),
    providerLatencyMs: z.null(),
    providerCostMicrousd: z.null(),
    providerSemantics: z.literal("unmeasured"),
    runtimeAcceptance: z.literal("unmeasured"),
    contractGatePassed: z.boolean(),
    aiReleaseAccepted: z.literal(false),
  })
  .strict();
export function buildAiContractReport(raw: unknown) {
  const observations = z
    .array(observation)
    .max(aiEvaluationCase.options.length)
    .parse(raw);
  if (
    new Set(observations.map((entry) => entry.caseId)).size !==
    observations.length
  )
    throw new Error("Duplicate evaluation case");
  const missing = aiEvaluationCase.options.filter(
    (id) => !observations.some((entry) => entry.caseId === id),
  );
  const passed = observations.filter(
    (entry) => entry.outcome === "pass",
  ).length;
  const failed = observations.filter(
    (entry) => entry.outcome === "fail",
  ).length;
  const errors = observations.filter(
    (entry) => entry.outcome === "error",
  ).length;
  return aiContractReport.parse({
    protocol: AI_CONTRACT_EVALUATION,
    fixtureVersion: "household-ai-contracts.2026-10-22.v1",
    measured: "offline-canonical-contracts",
    requiredCases: aiEvaluationCase.options.length,
    total: observations.length,
    passed,
    failed,
    errors,
    missing,
    // The denominator includes required missing cases; omission cannot improve a score.
    accuracyPercent: observations.length
      ? Math.round((passed / aiEvaluationCase.options.length) * 10000) / 100
      : null,
    observations,
    providerAnswerAccuracy: null,
    providerLatencyMs: null,
    providerCostMicrousd: null,
    providerSemantics: "unmeasured",
    runtimeAcceptance: "unmeasured",
    contractGatePassed: missing.length === 0 && failed === 0 && errors === 0,
    aiReleaseAccepted: false,
  });
}
