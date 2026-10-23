/** Authored/unrun exact lease/day-boundary cases. */
import { assistantGroundingLeaseCurrent } from "../assistant-grounding-lease";
const context = {
  generatedAt: "2026-10-10T03:59:40.000Z",
  expiresAt: "2026-10-10T04:00:40.000Z",
  viewer: { timeZone: "America/Toronto", localDate: "2026-10-09" },
};
it("refuses a local-day rollover before the time lease expires", () => {
  expect(
    assistantGroundingLeaseCurrent(
      context,
      Date.parse("2026-10-10T03:59:50.000Z"),
    ),
  ).toBe(true);
  expect(
    assistantGroundingLeaseCurrent(
      context,
      Date.parse("2026-10-10T04:00:00.000Z"),
    ),
  ).toBe(false);
});
it("refuses expiry, reversed wall clock and invalid named zones", () => {
  expect(
    assistantGroundingLeaseCurrent(context, Date.parse(context.expiresAt)),
  ).toBe(false);
  expect(
    assistantGroundingLeaseCurrent(
      context,
      Date.parse(context.generatedAt) - 1,
    ),
  ).toBe(false);
  expect(
    assistantGroundingLeaseCurrent(
      { ...context, viewer: { ...context.viewer, timeZone: "Not/AZone" } },
      Date.parse(context.generatedAt),
    ),
  ).toBe(false);
});
