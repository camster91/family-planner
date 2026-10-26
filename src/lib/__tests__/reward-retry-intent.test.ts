// Authored UNRUN: local window precondition only, no server-clock/receipt proof.
jest.mock("@/lib/idempotency-key", () => ({ ...jest.requireActual("@/lib/idempotency-key"), newIdempotencyKey: () => "5860e58e-8fbf-441b-a416-b8de07de13dc" }));
import { IDEMPOTENCY_TTL_MS } from "../idempotency-key";
import { createRewardRetryIntent, rewardRetryWithinWindow, sameRewardRetryIntent } from "../reward-retry-intent";
const start = Date.UTC(2026, 9, 25, 12);
it("keeps exact source/action/body/key/time without renewal", () => {
  const intent = createRewardRetryIntent("fixture-reward", "claim", start);
  expect(Object.isFrozen(intent)).toBe(true); expect(intent.body).toBe('{"rewardId":"fixture-reward"}');
  expect(rewardRetryWithinWindow(intent, start + IDEMPOTENCY_TTL_MS - 1)).toBe(true);
  expect(intent.issuedAt).toBe(start);
});
it("holds at the original receipt horizon or a reversed/invalid clock", () => {
  const intent = createRewardRetryIntent("fixture-reward", "approve", start);
  for (const now of [start - 1, start + IDEMPOTENCY_TTL_MS, Number.NaN, Infinity]) expect(rewardRetryWithinWindow(intent, now)).toBe(false);
});
it("does not equate changed action/body/time with an original uncertain request", () => {
  const intent = createRewardRetryIntent("fixture-reward", "claim", start);
  expect(sameRewardRetryIntent(intent, { ...intent, issuedAt: start + 1 })).toBe(false);
  expect(sameRewardRetryIntent(intent, { ...intent, kind: "approve" })).toBe(false);
  expect(rewardRetryWithinWindow({ ...intent, body: '{"rewardId":"other-reward"}' }, start)).toBe(false);
});

// Authored UNRUN: owned packet remains independent of changing display/context.
it("freezes original owner/birth/review terms in the exact owned body", () => {
  const owner = { userId: "fixture-child", familyId: "fixture-family", role: "child" as const, generation: 2 };
  const intent = createRewardRetryIntent("fixture-reward", "claim", start, { owner, sourceGeneration: "5b58743a-1f01-40fe-adb1-4628148495cb", expectedCost: 10 });
  owner.generation = 3;
  expect(JSON.parse(intent.body)).toMatchObject({ protocol: "herewoven.reward-action.v1", owner: { generation: 2 }, expectedCost: 10, issuedAt: start });
  expect(rewardRetryWithinWindow(intent, start + 1)).toBe(true);
  expect(Object.isFrozen(intent.command?.owner)).toBe(true);
});
it("refuses incomplete owned context instead of making a legacy request", () => {
  expect(() => createRewardRetryIntent("fixture-reward", "claim", start, { owner: { userId: "fixture-child", familyId: "fixture-family", role: "child", generation: 2 }, sourceGeneration: "unknown", expectedCost: 10 })).toThrow("unavailable");
});
