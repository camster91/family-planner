/** Authored/unrun. Exact transport and unknown-result handling, no actual I/O. */
jest.mock("../../owned-request-http", () => ({ requestOwnedJson: jest.fn() }));
jest.mock("../../idempotency-request-json", () => ({
  hashBrowserIdempotentRequest: jest.fn(async () => "a".repeat(64)),
}));
import { requestOwnedJson } from "../../owned-request-http";
import { makeFoodIntent, inspectFoodIntent, sendFoodIntent } from "../client";
import { FOOD_RECOVERY, foodRecoveryReply } from "../recovery-contract";
import { foodApplyReceiptMatches } from "../apply-contract";
import {
  context,
  makeCommand,
  makeEntry,
  receipt,
  now,
} from "./recovery-fixture";
const reply = (status: number, body: unknown) => ({
  kind: "reply" as const,
  response: { status, ok: status >= 200 && status < 300 } as Response,
  body,
});
afterEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
});
it("sends the original frozen body/key only through the fixed owner-bound save endpoint", async () => {
  const entry = makeFoodIntent(
    makeCommand(),
    context(),
    "food_request_123456789",
  );
  jest.mocked(requestOwnedJson).mockResolvedValue(reply(201, receipt()));
  expect(await sendFoodIntent(entry, context())).toEqual({
    kind: "confirmed",
    receipt: receipt(),
  });
  expect(requestOwnedJson).toHaveBeenCalledWith(
    "/api/assistant/food/apply",
    expect.objectContaining({
      body: entry.body,
      headers: expect.objectContaining({
        "Idempotency-Key": entry.key,
        "X-Herewoven-Food-Owner": context().owner!.scope,
      }),
    }),
    16384,
  );
});
it("keeps timeout, malformed success, conflict and authorization responses unknown", async () => {
  const entry = makeEntry(),
    original = { ...entry };
  for (const result of [
    { kind: "unknown" as const },
    reply(201, { meals: [], prep: null, groceries: [] }),
    reply(409, {}),
    reply(403, {}),
    reply(500, {}),
  ]) {
    jest.mocked(requestOwnedJson).mockResolvedValueOnce(result);
    expect(await sendFoodIntent(entry, context())).toEqual({ kind: "unknown" });
    expect(entry).toEqual(original);
  }
});
it("checks exact echoed body/key, current owner and independently computed request hash before retry eligibility", async () => {
  jest.spyOn(Date, "now").mockReturnValue(+now);
  const entry = makeEntry(),
    ctx = context();
  const proof = {
    contract: FOOD_RECOVERY,
    ownerScope: ctx.owner!.scope,
    entry,
    requestHash: "a".repeat(64),
    state: "ready",
    canRetry: true,
    retryUntil: new Date(+now + 60000).toISOString(),
    receipt: null,
  };
  jest.mocked(requestOwnedJson).mockResolvedValue(reply(200, proof));
  expect((await inspectFoodIntent(entry, ctx)).retryEligible).toBe(true);
  for (const changed of [
    { ...proof, requestHash: "d".repeat(64) },
    { ...proof, ownerScope: "d".repeat(64) },
    { ...proof, entry: { ...entry, body: ` ${entry.body}` } },
    { ...proof, entry: { ...entry, key: "different_request_123456" } },
  ]) {
    jest.mocked(requestOwnedJson).mockResolvedValueOnce(reply(200, changed));
    await expect(inspectFoodIntent(entry, ctx)).rejects.toThrow();
  }
  jest.spyOn(Date, "now").mockReturnValue(+now + 60000);
  expect((await inspectFoodIntent(entry, ctx)).retryEligible).toBe(false);
});
it("allows paused receipt inspection but prevents sending a new request", async () => {
  const entry = makeEntry(),
    ctx = { ...context(), enabled: false };
  jest.mocked(requestOwnedJson).mockResolvedValue(
    reply(200, {
      contract: FOOD_RECOVERY,
      ownerScope: ctx.owner!.scope,
      entry,
      requestHash: "a".repeat(64),
      state: "committed",
      canRetry: false,
      retryUntil: null,
      receipt: receipt(),
    }),
  );
  expect((await inspectFoodIntent(entry, ctx)).state).toBe("committed");
  await expect(sendFoodIntent(entry, ctx)).rejects.toThrow();
});
it("does not accept an unrelated recipe-plan pointer shape as a completed result", () => {
  const command = makeCommand();
  expect(foodApplyReceiptMatches(receipt(), command)).toBe(true);
  expect(
    foodApplyReceiptMatches(
      { ...receipt(), meals: [{ key: "another", mealId: "meal-a" }] },
      command,
    ),
  ).toBe(false);
  expect(
    foodRecoveryReply.safeParse({
      contract: FOOD_RECOVERY,
      ownerScope: context().owner!.scope,
      entry: makeEntry(),
      requestHash: "a".repeat(64),
      state: "pending",
      canRetry: true,
      retryUntil: now.toISOString(),
      receipt: null,
    }).success,
  ).toBe(false);
});
