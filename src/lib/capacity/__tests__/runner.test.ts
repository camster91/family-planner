/** Source only: fabricated callbacks, no app/DB/provider execution. */
import { capacityPlan, CAPACITY_SCENARIOS } from "../model";
import { runCapacityStage, type CapacityAdapters } from "../runner";
const env = { NODE_ENV: "test", FIXTURES_ALLOW: "1", CAPACITY_ALLOW: "local-fabricated-v1",
  DATABASE_URL: "postgresql://fixture:fixture@localhost/capacity_test", PERF_BASE_URL: "http://127.0.0.1:3000" };
function setup() {
  const action = jest.fn(async () => ({ outcome: "confirmed" as const, requests: 1, responseBytes: 0 }));
  return { plan: capacityPlan({ stage: "reference", profile: "ordinary" }), sourceCommit: "a".repeat(40), env,
    adapters: Object.fromEntries(CAPACITY_SCENARIOS.map(({ name }) => [name, action])) as unknown as CapacityAdapters,
    reconcile: jest.fn(async () => true), resourceLimitReached: jest.fn(async () => false), action };
}
afterEach(() => jest.useRealTimers());
it("refuses missing adoption or any missing domain before reconciliation", async () => {
  const input = setup();
  await expect(runCapacityStage({ ...input, env: { ...env, CAPACITY_ALLOW: "" } })).rejects.toThrow();
  await expect(runCapacityStage({ ...input, adapters: {} as CapacityAdapters })).rejects.toThrow();
  expect(input.reconcile).not.toHaveBeenCalled();
  expect(input.action).not.toHaveBeenCalled();
});
it("refuses a changed stage ceiling and remote application target", async () => {
  const input = setup();
  await expect(runCapacityStage({ ...input, plan: { ...input.plan, sessions: 1000 } as unknown as typeof input.plan })).rejects.toThrow();
  await expect(runCapacityStage({ ...input, env: { ...env, PERF_BASE_URL: "https://example.com" } })).rejects.toThrow();
  expect(input.action).not.toHaveBeenCalled();
});
it("does not start offered load when canonical before reconciliation refuses", async () => {
  const input = setup(); input.reconcile.mockResolvedValue(false);
  const report = await runCapacityStage(input);
  expect(report.stopReason).toBe("reconciliation");
  expect(report.reconciledAfter).toBe(false);
  expect(input.action).not.toHaveBeenCalled();
});
it("stops the entire stage on an abort-ignoring scenario, without a second scenario or unsafe reconciliation", async () => {
  jest.useFakeTimers();
  const input = setup();
  input.action.mockImplementation(async () => new Promise<never>(() => undefined));
  const pending = runCapacityStage(input);
  await jest.advanceTimersByTimeAsync(60_001);
  const report = await pending;
  expect(report.stopReason).toBe("scenario-timeout");
  expect(input.action).toHaveBeenCalledTimes(1);
  expect(input.reconcile.mock.calls).toHaveLength(1);
  expect(report.reconciledAfter).toBe(false);
});
