/** Authored/unrun. Review observations only; never invokes an AI provider. */
import { buildReviewedProviderReport } from "../provider-report";
const input = (observations: unknown[] = []) => ({
  protocol: "herewoven.ai-reviewed-observations.v1",
  fixtureVersion: "household-ai-reviewed.2026-10-22.v1",
  providerConfigHash: "a".repeat(64),
  observations,
});
const sample = { caseId: "invented-reference", outputDigest: "b".repeat(64) };
it("does not infer correct answers, free calls or zero latency from missing observations", () => {
  const report = buildReviewedProviderReport(input([sample]));
  expect(report.scores.grounded).toMatchObject({ measured: 0, percent: null });
  expect(report.knownEstimatedMicrousd).toBeNull();
  expect(report.averageObservedLatencyMs).toBeNull();
  expect(report.estimatedMicrousdPerSuccessfulJob).toBeNull();
  expect(report.observationGatePassed).toBe(false);
  expect(report.aiReleaseAccepted).toBe(false);
});
it("keeps known costs separate and requires explicit reviewer grades", () => {
  const reviewed = {
    ...sample,
    reviewerChecked: true,
    reviewedAt: "2026-10-22T12:00:00Z",
    deliveredUsableReply: true,
    intentCorrect: true,
    grounded: true,
    actionSchemaValid: true,
    refusalOrClarificationCorrect: true,
    latencyMs: 120,
    estimatedCostMicrousd: "300",
  };
  const report = buildReviewedProviderReport(input([reviewed]));
  expect(report.estimatedMicrousdPerSuccessfulJob).toBe("300");
  expect(report.observationGatePassed).toBe(false);
  const incomplete = buildReviewedProviderReport(
    input([reviewed, { ...sample, caseId: "deleted-reference" }]),
  );
  expect(incomplete.unknownReplyOutcomeJobs).toBe(1);
  expect(incomplete.estimatedMicrousdPerSuccessfulJob).toBeNull();
  expect(() =>
    buildReviewedProviderReport(
      input([{ ...reviewed, reviewerChecked: false }]),
    ),
  ).toThrow();
  expect(() =>
    buildReviewedProviderReport(input([reviewed, reviewed])),
  ).toThrow();
  expect(() =>
    buildReviewedProviderReport(
      input([{ ...reviewed, reply: "Do not store this" }]),
    ),
  ).toThrow();
});
