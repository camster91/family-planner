/** Source only: notification destinations never become an arbitrary navigation URL. */
import { notificationDestination } from "../notification-destination";
it("opens the current canonical summary destination", () => {
  expect(notificationDestination("/dashboard/today")).toBe("/dashboard/today");
});
it.each([null, undefined, {}, 7, "", "https://example.test", "//example.test",
  "javascript:alert(1)", "/dashboard/today?token=fixture", "/dashboard/today#private",
  "/dashboard/today/../settings", "/dashboard/settings", "/dashboard/chores/edit?id=fixture",
  "%2Fdashboard%2Ftoday", " /dashboard/today", "/dashboard/today\\other",
])("withholds unknown, private or malformed destinations (%s)", value => {
  expect(notificationDestination(value)).toBeNull();
});


// Additional source cases authored UNRUN for the first typed exact destination.
it("admits only canonical plain-ID chore focus links", () => {
  expect(notificationDestination("/dashboard/chores?focus=fixture-chore_01")).toBe("/dashboard/chores?focus=fixture-chore_01");
});
it.each(["/dashboard/chores?focus=", "/dashboard/chores?focus=fixture&extra=1", "/dashboard/chores?focus=fixture#token", "/dashboard/chores?focus=%66ixture", "/dashboard/chores?focus=a/b", "/dashboard/chores?focus=a?focus=b", "/dashboard/chores?focus=" + "a".repeat(129)])("rejects ambiguous focus destinations (%s)", value => {
  expect(notificationDestination(value)).toBeNull();
});

// Authored UNRUN: reward links are exact plain canonical IDs, never URL input.
it("admits a canonical reward focus without an arbitrary action URL", () => {
  expect(notificationDestination("/dashboard/rewards?focus=fixture-reward_01")).toBe("/dashboard/rewards?focus=fixture-reward_01");
});
it.each(["/dashboard/rewards?focus=", "/dashboard/rewards?focus=fixture&extra=1", "/dashboard/rewards?focus=fixture#private", "/dashboard/rewards?focus=%66ixture", "/dashboard/rewards?focus=a/b", "/dashboard/rewards?focus=a?focus=b", "/dashboard/rewards?focus=" + "a".repeat(129)])("rejects ambiguous reward destinations (%s)", value => {
  expect(notificationDestination(value)).toBeNull();
});
