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
