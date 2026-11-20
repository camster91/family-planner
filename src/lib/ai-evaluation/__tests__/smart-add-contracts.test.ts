import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
/** Smart Add contract fixtures (#144). Offline; no provider, database or flag. */
import {
  evaluateSmartAddCase,
  runSmartAddContractEvaluation,
  smartAddCases,
} from "../smart-add-contracts";

it("can fail: a wrong expectation, a leaked name or an accepted injection is reported", () => {
  const base = smartAddCases[0];
  expect(
    evaluateSmartAddCase({
      ...base,
      expect: {
        drafts: [{ kind: "event", start: "2026-11-24T19:30:00.000Z" }, {}, {}],
      },
    }).pass,
  ).toBe(false);
  expect(
    evaluateSmartAddCase({ ...base, expect: { notSent: ["Person B"] } })
      .reasons,
  ).toEqual(["sent:Person B"]);
  const injection = smartAddCases.find(
    (c) => c.id === "injection-extra-action-refused",
  )!;
  expect(
    evaluateSmartAddCase({
      ...injection,
      providerAnswer: { status: "ok", items: [] },
    }).reasons,
  ).toEqual(["schema-accepted"]);
});

it("has at least fifteen fixed smart Add cases with unique ids across every dimension", () => {
  expect(smartAddCases.length).toBeGreaterThanOrEqual(15);
  expect(new Set(smartAddCases.map((c) => c.id)).size).toBe(
    smartAddCases.length,
  );
  expect(new Set(smartAddCases.map((c) => c.dimension))).toEqual(
    new Set([
      "multi-item",
      "dates",
      "people",
      "privacy",
      "injection",
      "schema",
      "bounds",
    ]),
  );
});

it("meets every smart Add contract without claiming provider quality", () => {
  const report = runSmartAddContractEvaluation();
  if (process.env.WRITE_AI_CONTRACT_REPORT === "1") {
    const directory = join(process.cwd(), "test-results");
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, "smart-add-contract-report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  }
  expect(report.results.filter((r) => r.outcome !== "pass")).toEqual([]);
  expect(report).toMatchObject({
    contractGatePassed: true,
    providerSemantics: "unmeasured",
    providerAnswerAccuracy: null,
    aiReleaseAccepted: false,
  });
});
