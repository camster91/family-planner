/** Authored/unrun. Fabricated in-memory adapters; no provider/DB invocation. */
jest.mock("../../auth", () => ({
  getJwtSecret: () => "synthetic-only-evaluation-key",
}));
jest.mock("../server", () => ({
  previewFoodPlan: jest.fn(),
  previewFoodPlanInTx: jest.fn(),
}));
jest.mock("../ai-gates", () => ({ foodAiEnabled: jest.fn(() => true) }));
jest.mock("../../capture", () => ({
  structuredFoodPlanReply: jest.fn(),
  resolveCaptureConfig: jest.fn(),
}));
import type { PrismaClient } from "@prisma/client";
import { previewFoodPlan, previewFoodPlanInTx } from "../server";
import { foodAiEnabled } from "../ai-gates";
import { structuredFoodPlanReply, resolveCaptureConfig } from "../../capture";
import { normalizeFeatures } from "../../features";
import { suggestFoodPlan } from "../ai-server";
import { buildFoodAiCatalog } from "../ai-catalog";
import { aiFixture, issuedReply } from "./ai-fixture";
import { actor } from "./recovery-fixture";
import type { AiUsageJob } from "../../ai-usage-server";
function setup() {
  const { original, proposal } = aiFixture();
  const family = {
    features: null,
    capture_ai_key_enc: null,
    capture_ai_base_url: null,
    capture_ai_model: null,
  };
  const config = {
    apiKey: "synthetic-not-a-secret",
    baseUrl: "https://provider.invalid/v1",
    model: "synthetic",
    userSuppliedUrl: false,
  };
  const tx = { family: { findUnique: jest.fn().mockResolvedValue(family) } };
  const transaction = jest.fn(
    async (run: (value: unknown) => Promise<unknown>) => run(tx),
  );
  const db = { $transaction: transaction } as unknown as Pick<
    PrismaClient,
    "$transaction"
  >;
  const meter = {
    observer: { start: jest.fn(), response: jest.fn(), failed: jest.fn() },
    replyAllowed: jest.fn().mockResolvedValue(true),
    finish: jest.fn(),
  } as unknown as Exclude<AiUsageJob, undefined>;
  const renew = jest.fn().mockResolvedValue(true);
  jest.mocked(previewFoodPlan).mockResolvedValue(original);
  jest
    .mocked(previewFoodPlanInTx)
    .mockResolvedValueOnce(original)
    .mockResolvedValueOnce(proposal);
  jest.mocked(resolveCaptureConfig).mockReturnValue(config);
  jest
    .mocked(structuredFoodPlanReply)
    .mockResolvedValue(issuedReply(buildFoodAiCatalog(original)));
  return {
    original,
    proposal,
    transaction,
    meter,
    renew,
    run: () =>
      suggestFoodPlan(
        db,
        actor,
        {
          sourceRequest: original.sourceRequest,
          preference: "Synthetic preference",
        },
        config,
        normalizeFeatures(null),
        meter,
        renew,
      ),
  };
}
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date("2026-10-22T12:00:00Z"));
  jest.mocked(foodAiEnabled).mockReturnValue(true);
});
afterEach(() => {
  jest.useRealTimers();
  jest.resetAllMocks();
});
it("reconstructs the selected canonical query in one read snapshot without extending the source lease", async () => {
  const s = setup(),
    result = await s.run();
  expect(result.proposal).toEqual(s.proposal);
  expect(result.original.generatedAt).toBe(result.proposal.generatedAt);
  expect(s.transaction).toHaveBeenCalledWith(expect.any(Function), {
    isolationLevel: "RepeatableRead",
    timeout: 15000,
  });
  expect(previewFoodPlanInTx).toHaveBeenLastCalledWith(
    expect.anything(),
    actor,
    s.proposal.sourceRequest,
    new Date(s.original.generatedAt),
  );
  expect(structuredFoodPlanReply).toHaveBeenCalledWith(
    expect.anything(),
    "Synthetic preference",
    expect.anything(),
    s.meter.observer,
  );
});
it("refuses changed canonical sources after a provider response", async () => {
  const s = setup();
  jest
    .mocked(previewFoodPlanInTx)
    .mockReset()
    .mockResolvedValue({ ...s.original, snapshotRevision: "b".repeat(64) });
  await expect(s.run()).rejects.toThrow("AI_SOURCE_CHANGED");
  expect(previewFoodPlanInTx).toHaveBeenCalledTimes(1);
});
it("refuses expired, signed-out and paused results without opening reconstruction", async () => {
  for (const change of ["expired", "owner", "paused"] as const) {
    jest.clearAllMocks();
    const s = setup();
    jest.mocked(structuredFoodPlanReply).mockImplementationOnce(async () => {
      if (change === "expired")
        jest.setSystemTime(new Date(s.original.expiresAt));
      if (change === "owner") s.renew.mockResolvedValue(false);
      if (change === "paused")
        jest.mocked(foodAiEnabled).mockReturnValue(false);
      return issuedReply(buildFoodAiCatalog(s.original));
    });
    await expect(s.run()).rejects.toThrow("AI_SOURCE_CHANGED");
    expect(s.transaction).not.toHaveBeenCalled();
    jest.setSystemTime(new Date("2026-10-22T12:00:00Z"));
    jest.mocked(foodAiEnabled).mockReturnValue(true);
    jest.mocked(previewFoodPlanInTx).mockReset();
  }
});
