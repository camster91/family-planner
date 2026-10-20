/** Authored only: no DB, SQL, schema or QA command has run. */
import {
  scheduleEventToken,
  scheduleSnapshotToken,
  scheduleComparisonPredicate,
  applyComparedScheduleMoveInTx,
} from "../schedule-source";
const source = {
  id: "event-a",
  generation: "52d281b8-bffc-4d66-acda-f6f7adb65f7f",
  epoch: 2,
};
const scope = {
  owner: { userId: "person-a", familyId: "family-a" },
  role: "parent" as const,
  tokenVersion: 1,
  timeZone: "America/Toronto",
  range: { start: "2026-10-19T00:00:00Z", end: "2026-10-26T00:00:00Z" },
  coverage: {
    complete: true,
    recurrence: "complete" as const,
    sourcesUnavailable: false,
    capped: false,
  },
  events: [
    { id: source.id, sourceToken: scheduleEventToken("family-a", source) },
  ],
};
it("binds household, insertion generation and material epoch, including away/back and recreated IDs", () => {
  const original = scheduleEventToken("family-a", source);
  expect(scheduleEventToken("family-b", source)).not.toBe(original);
  expect(
    scheduleEventToken("family-a", { ...source, epoch: source.epoch + 2 }),
  ).not.toBe(original);
  expect(
    scheduleEventToken("family-a", {
      ...source,
      generation: "d7fd9b42-f48a-4ccd-9df5-eb3488071835",
    }),
  ).not.toBe(original);
  expect(() =>
    scheduleEventToken("family-a", { ...source, epoch: 2147483647 }),
  ).toThrow();
});
it("binds owner/session/zone/range/coverage and sorted comparison sources without order dependence", () => {
  const token = scheduleSnapshotToken(scope);
  for (const changed of [
    { ...scope, owner: { ...scope.owner, userId: "person-b" } },
    { ...scope, tokenVersion: 2 },
    { ...scope, timeZone: "UTC" },
    { ...scope, coverage: { ...scope.coverage, capped: true } },
    { ...scope, range: { ...scope.range, end: "2026-10-27T00:00:00Z" } },
    { ...scope, events: [] },
  ])
    expect(scheduleSnapshotToken(changed)).not.toBe(token);
  const events = [
    ...scope.events,
    { id: "event-b", sourceToken: "b".repeat(64) },
  ];
  expect(scheduleSnapshotToken({ ...scope, events })).toBe(
    scheduleSnapshotToken({ ...scope, events: [...events].reverse() }),
  );
  expect(() =>
    scheduleSnapshotToken({
      ...scope,
      events: [...scope.events, ...scope.events],
    }),
  ).toThrow();
});
it("validates the range before building any SQL, including padded year limits", () => {
  expect(() =>
    scheduleComparisonPredicate("family-a", source.id, {
      start: "bad",
      end: scope.range.end,
    }),
  ).toThrow();
  expect(() =>
    scheduleComparisonPredicate("family-a", source.id, {
      start: scope.range.start,
      end: scope.range.start,
    }),
  ).toThrow();
  expect(() =>
    scheduleComparisonPredicate("family-a", source.id, {
      start: "0001-01-01T00:00:00Z",
      end: "0001-01-02T00:00:00Z",
    }),
  ).toThrow();
});
it("treats no atomic effect as a conflict, not success or a replacement request", async () => {
  const query = jest.fn(async () => []),
    tx = { $queryRaw: query };
  await expect(
    applyComparedScheduleMoveInTx(tx as never, {
      familyId: scope.owner.familyId,
      targetId: source.id,
      range: scope.range,
      compared: [source],
      start: "2026-10-20T12:00:00Z",
      end: "2026-10-20T13:00:00Z",
    }),
  ).rejects.toMatchObject({ code: "STALE" });
  expect(query).toHaveBeenCalledTimes(1);
});
