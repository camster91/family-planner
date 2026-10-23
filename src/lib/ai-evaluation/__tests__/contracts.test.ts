import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
/** Authored/unrun. One consolidated offline evaluation; no provider/DB fixture. */
import { runAiContractEvaluation } from "../contracts";
import { buildAiContractReport, aiEvaluationCase } from "../report";
it("meets every versioned canonical contract without claiming measured provider quality, cost or runtime acceptance", () => {
  const report = runAiContractEvaluation();
  if (process.env.WRITE_AI_CONTRACT_REPORT === "1") {
    const directory = join(process.cwd(), "test-results");
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, "ai-contract-report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  }
  expect(report.missing).toEqual([]);
  expect(
    report.observations.filter((entry) => entry.outcome !== "pass"),
  ).toEqual([]);
  expect(report.total).toBe(aiEvaluationCase.options.length);
  expect(report.contractGatePassed).toBe(true);
  expect(report).toMatchObject({
    providerSemantics: "unmeasured",
    providerAnswerAccuracy: null,
    providerLatencyMs: null,
    providerCostMicrousd: null,
    runtimeAcceptance: "unmeasured",
    aiReleaseAccepted: false,
  });
});
it("keeps missing cases in the score denominator and never treats an empty or duplicate report as complete", () => {
  const empty = buildAiContractReport([]);
  expect(empty.accuracyPercent).toBeNull();
  expect(empty.contractGatePassed).toBe(false);
  expect(empty.missing).toEqual(aiEvaluationCase.options);
  const single = {
    caseId: "invented-reference",
    dimension: "grounding",
    outcome: "pass",
  };
  expect(buildAiContractReport([single]).accuracyPercent).toBeLessThan(100);
  expect(() => buildAiContractReport([single, single])).toThrow();
  expect(() =>
    buildAiContractReport([{ ...single, dimension: "scope" }]),
  ).toThrow();
  expect(() =>
    buildAiContractReport([{ ...single, prompt: "Do not collect this" }]),
  ).toThrow();
});
