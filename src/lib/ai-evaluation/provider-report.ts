/** Aggregate reviewed provider observations without storing prompts or replies.
 * Grades are explicit reviewer input, not automated truth claims about prose.
 * Unknown grades, prices and latency remain unknown and prevent acceptance. */
import { z } from "zod";
import { aiEvaluationCase } from "./report";
export const aiReviewedEvaluationCase = z.enum([
  ...aiEvaluationCase.options,
  "provider-timeout",
  "provider-rate-limit",
  "unknown-result-retry",
]);
const grade = z.boolean().nullable().default(null);
export const reviewedAiSample = z
  .object({
    caseId: aiReviewedEvaluationCase,
    outputDigest: z.string().regex(/^[a-f0-9]{64}$/),
    reviewerChecked: z.boolean().default(false),
    reviewedAt: z.string().datetime().nullable().default(null),
    deliveredUsableReply: z.boolean().nullable().default(null),
    intentCorrect: grade,
    grounded: grade,
    actionSchemaValid: grade,
    refusalOrClarificationCorrect: grade,
    latencyMs: z.number().int().min(0).max(300000).nullable().default(null),
    estimatedCostMicrousd: z
      .string()
      .regex(/^(0|[1-9][0-9]{0,12})$/)
      .refine((value) => BigInt(value) <= BigInt("1000000000000"))
      .nullable()
      .default(null),
  })
  .strict()
  .refine((sample) =>
    sample.reviewerChecked
      ? sample.reviewedAt !== null
      : sample.reviewedAt === null &&
        [
          sample.intentCorrect,
          sample.grounded,
          sample.actionSchemaValid,
          sample.refusalOrClarificationCorrect,
        ].every((value) => value === null),
  );

export const providerEvaluationInput = z
  .object({
    protocol: z.literal("herewoven.ai-reviewed-observations.v1"),
    fixtureVersion: z.literal("household-ai-reviewed.2026-10-22.v1"),
    providerConfigHash: z.string().regex(/^[a-f0-9]{64}$/),
    observations: z
      .array(reviewedAiSample)
      .max(aiReviewedEvaluationCase.options.length),
  })
  .strict();
export function buildReviewedProviderReport(raw: unknown) {
  const input = providerEvaluationInput.parse(raw),
    samples = input.observations;
  if (new Set(samples.map((row) => row.caseId)).size !== samples.length)
    throw new Error("Duplicate provider evaluation case");
  const missing = aiReviewedEvaluationCase.options.filter(
    (id) => !samples.some((row) => row.caseId === id),
  );
  const dimensions = [
    "intentCorrect",
    "grounded",
    "actionSchemaValid",
    "refusalOrClarificationCorrect",
  ] as const;
  const scores = Object.fromEntries(
    dimensions.map((dimension) => {
      const measured = samples.filter(
        (row) => row.reviewerChecked && row[dimension] !== null,
      );
      return [
        dimension,
        {
          measured: measured.length,
          correct: measured.filter((row) => row[dimension] === true).length,
          percent: measured.length
            ? Math.round(
                (measured.filter((row) => row[dimension] === true).length /
                  measured.length) *
                  10000,
              ) / 100
            : null,
        },
      ];
    }),
  );
  const passed = samples.filter(
    (row) =>
      row.reviewerChecked &&
      dimensions.every((dimension) => row[dimension] === true),
  );
  const successful = passed.filter((row) => row.deliveredUsableReply === true);
  const timed = samples.filter((row) => row.latencyMs !== null);
  const priced = samples.filter((row) => row.estimatedCostMicrousd !== null);
  const pricedSuccesses = successful.filter(
    (row) => row.estimatedCostMicrousd !== null,
  );
  const total = (rows: typeof samples) =>
    rows.reduce(
      (sum, row) => sum + BigInt(row.estimatedCostMicrousd!),
      BigInt("0"),
    );
  const outcomesComplete = samples.every(
    (row) => row.deliveredUsableReply !== null,
  );
  const complete =
    outcomesComplete &&
    missing.length === 0 &&
    passed.length === aiReviewedEvaluationCase.options.length &&
    timed.length === samples.length &&
    priced.length === samples.length;
  return {
    protocol: "herewoven.ai-reviewed-report.v1" as const,
    fixtureVersion: input.fixtureVersion,
    providerConfigHash: input.providerConfigHash,
    gradeSource: "explicit-reviewer-observations" as const,
    sampleEvidence: samples.map(
      ({ caseId, outputDigest, reviewerChecked, reviewedAt }) => ({
        caseId,
        outputDigest,
        reviewerChecked,
        reviewedAt,
      }),
    ),
    requiredCases: aiReviewedEvaluationCase.options.length,
    observedCases: samples.length,
    missing,
    scores,
    passedCases: passed.length,
    qualityObservationGatePassed:
      missing.length === 0 &&
      passed.length === aiReviewedEvaluationCase.options.length,
    successfulJobs: successful.length,
    unknownReplyOutcomeJobs: samples.filter(
      (row) => row.deliveredUsableReply === null,
    ).length,
    timedJobs: timed.length,
    unknownLatencyJobs: samples.length - timed.length,
    averageObservedLatencyMs: timed.length
      ? Math.round(
          timed.reduce((sum, row) => sum + row.latencyMs!, 0) / timed.length,
        )
      : null,
    pricedJobs: priced.length,
    unknownCostJobs: samples.length - priced.length,
    knownEstimatedMicrousd: priced.length ? total(priced).toString() : null,
    // Do not divide a known subtotal by successes whose costs are unknown.
    estimatedMicrousdPerSuccessfulJob:
      outcomesComplete &&
      successful.length &&
      pricedSuccesses.length === successful.length
        ? (
            (total(pricedSuccesses) + BigInt(successful.length) - BigInt("1")) /
            BigInt(successful.length)
          ).toString()
        : null,
    averageCostRounding: "up-to-integer-microusd" as const,
    observationGatePassed: complete,
    // This report cannot establish canonical writes, isolation, replay, browser,
    // provider eligibility, production rollout or customer acceptance.
    runtimeAcceptance: "separate-required" as const,
    aiReleaseAccepted: false as const,
  };
}
