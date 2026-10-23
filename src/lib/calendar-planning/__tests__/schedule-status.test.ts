/** Authored/unrun: shared source policy boundaries, not provider freshness evidence. */
import {
  assessScheduleSourceCoverage,
  SCHEDULE_SOURCE_FRESHNESS_MS,
} from "../schedule-status";
const now = new Date("2026-10-22T12:00:00Z");
const source = {
  kind: "connection" as const,
  id: "connection-a",
  status: "ok",
  checkedAt: now,
  updatedAt: now,
  generation: 1,
};
const row = { sourceConnectionId: "connection-a", sourceSubscriptionId: null };
it("keeps the existing freshness boundary and refuses stale/future/orphan sources", () => {
  expect(
    assessScheduleSourceCoverage(
      [row],
      [{ ...source, checkedAt: new Date(+now - SCHEDULE_SOURCE_FRESHNESS_MS) }],
      now,
    ).sourcesUnavailable,
  ).toBe(false);
  for (const checkedAt of [
    new Date(+now - SCHEDULE_SOURCE_FRESHNESS_MS - 1),
    new Date(+now + 60001),
    null,
  ])
    expect(
      assessScheduleSourceCoverage([row], [{ ...source, checkedAt }], now)
        .sourcesUnavailable,
    ).toBe(true);
  expect(assessScheduleSourceCoverage([row], [], now)).toMatchObject({
    missingSource: true,
    sourcesUnavailable: true,
  });
});
it("does not promote a capped event or source list into complete comparison coverage", () => {
  expect(
    assessScheduleSourceCoverage(
      Array.from({ length: 501 }, () => row),
      [source],
      now,
    ).capped,
  ).toBe(true);
  expect(
    assessScheduleSourceCoverage(
      [],
      Array.from({ length: 101 }, (_, i) => ({ ...source, id: `source-${i}` })),
      now,
    ).capped,
  ).toBe(true);
});
