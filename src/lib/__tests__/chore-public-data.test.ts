/** Source only; final API/rendered acceptance is deferred. */
import { publicChoreData } from "../chore-public-data";
it("strips future definitions from ordinary row, template and cached nested response shapes without changing occurrence snapshots", () => {
  const date = new Date("2026-10-21T00:00:00.000Z");
  const fixture = {
    chore: {
      id: "fixture-child-step",
      title: "Fixture breakfast",
      due_date: date,
      routine_anchor: "After breakfast",
      routine_duration_minutes: 10,
      routine_series_config: {
        content: { title: "Private future parent step" },
      },
    },
    template: {
      id: "fixture-root",
      routine_series_config: { token: "fixture-private-marker" },
    },
    metadata: { schedule_config: { futureMember: "fixture-parent" }, count: 2 },
  };
  const result = publicChoreData(fixture);
  expect(result).toEqual({
    chore: {
      id: "fixture-child-step",
      title: "Fixture breakfast",
      due_date: date,
      routine_anchor: "After breakfast",
      routine_duration_minutes: 10,
    },
    template: { id: "fixture-root" },
    metadata: { count: 2 },
  });
  expect(result.chore.due_date).toBe(date);
  expect(fixture.chore.routine_series_config.content.title).toContain(
    "Private",
  );
  expect(JSON.stringify(result)).not.toContain("fixture-private-marker");
});
it("handles arrays, null and ordinary errors without removing unrelated content", () => {
  expect(
    publicChoreData([
      { id: "a", routine_series_config: null },
      { id: "b", note: "schedule_config" },
    ]),
  ).toEqual([{ id: "a" }, { id: "b", note: "schedule_config" }]);
  expect(publicChoreData({ error: { code: "FORBIDDEN" } })).toEqual({
    error: { code: "FORBIDDEN" },
  });
});
