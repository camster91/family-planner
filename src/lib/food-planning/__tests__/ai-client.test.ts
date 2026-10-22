/** Authored/unrun. No network/provider dispatch while authoring these cases. */
jest.mock("../../owned-request-http", () => ({ requestOwnedJson: jest.fn() }));
import { requestOwnedJson } from "../../owned-request-http";
import { readFoodAiSuggestion } from "../client";
import { FOOD_OWNER_HEADER } from "../recovery-contract";
import { FOOD_AI } from "../ai-contract";
import { evaluateFoodAiProposal } from "../ai-evaluation";
import { context } from "./recovery-fixture";
import { aiFixture } from "./ai-fixture";
const transport = jest.mocked(requestOwnedJson);
function fixture() {
  const { original, proposal } = aiFixture();
  return {
    protocol: FOOD_AI,
    original,
    proposal,
    evidence: [
      {
        key: "dinner",
        recipeId: "recipe-b",
        ref: `frc1_${"a".repeat(64)}`,
        label: "Synthetic b",
        source: "household-recipe",
      },
    ],
    evaluation: evaluateFoodAiProposal(original, proposal),
  };
}
const response = (body: unknown) => ({
  kind: "reply" as const,
  response: { status: 200, ok: true } as Response,
  body,
});
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date("2026-10-22T12:00:00Z"));
});
afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});
it("requires explicit capability before any provider request", async () => {
  await expect(
    readFoodAiSuggestion(fixture().original.sourceRequest, "", context()),
  ).rejects.toThrow();
  expect(transport).not.toHaveBeenCalled();
});
it("renews person authority and capability before returning a validated suggestion", async () => {
  const result = fixture(),
    ctx = { ...context(), canAskAi: true };
  transport
    .mockResolvedValueOnce(response(result))
    .mockResolvedValue(response(ctx));
  await expect(
    readFoodAiSuggestion(
      result.original.sourceRequest,
      "Synthetic preference",
      ctx,
    ),
  ).resolves.toEqual(result);
  expect(transport.mock.calls[0][0]).toBe("/api/assistant/food/suggest");
  expect(transport.mock.calls[0][1]).toMatchObject({
    method: "POST",
    headers: { [FOOD_OWNER_HEADER]: ctx.owner!.scope },
  });
  expect(
    transport.mock.calls
      .slice(1)
      .every(([url]) => url === "/api/assistant/food/context"),
  ).toBe(true);
});
it("rejects delayed owner/capability changes, expired results and altered evaluation", async () => {
  const ctx = { ...context(), canAskAi: true };
  for (const change of [
    "owner",
    "capability",
    "expired",
    "evaluation",
  ] as const) {
    transport.mockReset();
    const result = fixture();
    if (change === "expired")
      result.original.generatedAt = "2026-10-22T11:00:00Z";
    if (change === "evaluation") result.evaluation.changedRecipes = 0;
    const renewed =
      change === "owner"
        ? { ...ctx, familyId: "other-family" }
        : change === "capability"
          ? { ...ctx, canAskAi: false }
          : ctx;
    transport
      .mockResolvedValueOnce(response(result))
      .mockResolvedValue(response(renewed));
    await expect(
      readFoodAiSuggestion(result.original.sourceRequest, "", ctx),
    ).rejects.toThrow();
  }
});
