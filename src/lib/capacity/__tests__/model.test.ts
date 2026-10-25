/** Source only; no capacity run, application request, fixture or database. */
import { capacityPlan, capacityIntents, CAPACITY_SCENARIOS } from "../model";

it("retains all eight weighted domains and never silently rounds small-stage skews away", () => {
  expect(CAPACITY_SCENARIOS.reduce((sum, scenario) => sum + scenario.weight, 0)).toBe(100);
  expect(() => capacityPlan({ stage: "beta" })).toThrow("explicit profile");
  expect(capacityPlan({ stage: "reference", profile: "history" }).trafficHouseholds
    .every(household => household.profile === "history")).toBe(true);
});
it("constructs exact70/10/10/10 household profiles in the larger stage", () => {
  const plan = capacityPlan({ stage: "contention" });
  expect(["ordinary", "calendar", "food", "history"].map(profile =>
    plan.trafficHouseholds.filter(household => household.profile === profile).length))
    .toEqual([14, 2, 2, 2]);
});
it("reproduces each worker stream independently without dispatching sentinel households", () => {
  const plan = capacityPlan({ stage: "contention", hotHouseholds: true });
  const first = capacityIntents(plan, 0), second = capacityIntents(plan, 0);
  const other = capacityIntents(plan, 1);
  for (let i = 0; i < 1000; i++) {
    const intent = first();
    other(); other();
    expect(intent).toEqual(second());
    expect(plan.sentinelOrdinals).not.toContain(intent.householdOrdinal);
    expect(intent.thinkMs).toBeGreaterThanOrEqual(2000);
    expect(intent.thinkMs).toBeLessThanOrEqual(5000);
    if (intent.shared) expect(["today", "groceries"]).toContain(intent.scenario);
  }
});
it("refuses workers outside the declared stage", () => {
  const plan = capacityPlan({ stage: "reference", profile: "ordinary" });
  expect(() => capacityIntents(plan, 1)).toThrow();
  expect(() => capacityIntents(plan, -1)).toThrow();
});
