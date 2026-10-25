/** Authored/unrun. Private read projections/bounds, not PostgreSQL lock proof. */
import type { Prisma } from "@prisma/client";
import { readProjectCalendarTaskBatch, PROJECT_CALENDAR_TASK_BATCH } from "../project-calendar";
const scope = { familyId: "family-a", projectId: "project-a" };
it("scopes a bounded task read and asks only for candidate UID/title existence", async () => {
  const tasks = [
    { id: "task-a", title: "Same label", description: null, due_date: new Date("2026-10-24") },
    { id: "task-b", title: "Same label", description: null, due_date: new Date("2026-10-24") },
    { id: "task-c", title: "Legacy label", description: null, due_date: new Date("2026-10-24") },
  ];
  const findMany = jest.fn().mockResolvedValue(tasks);
  const groupBy = jest.fn()
    .mockResolvedValueOnce([{ source_uid: "project-task:task-a" }])
    .mockResolvedValueOnce([{ title: "Legacy label" }]);
  const tx = { projectTask: { findMany }, event: { groupBy } } as unknown as Prisma.TransactionClient;
  const result = await readProjectCalendarTaskBatch(tx, scope, "previous-task");
  expect(result.tasks).toEqual(tasks);
  // A linked task does not block another task sharing the same title.
  expect(result.unsent).toEqual([tasks[1]]);
  expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: {
      project_id: "project-a", project: { family_id: "family-a" },
      completed: false, due_date: { not: null }, id: { gt: "previous-task" },
    },
    take: PROJECT_CALENDAR_TASK_BATCH, orderBy: { id: "asc" },
  }));
  expect(groupBy.mock.calls[0][0]).toEqual({
    by: ["source_uid"], where: {
      family_id: "family-a", project_id: "project-a", is_task: true,
      source_uid: { in: ["project-task:task-a", "project-task:task-b", "project-task:task-c"] },
    },
  });
  expect(groupBy.mock.calls[1][0]).toEqual({
    by: ["title"], where: {
      family_id: "family-a", project_id: "project-a", is_task: true,
      title: { in: ["Same label", "Legacy label"] },
      OR: [{ source_uid: null }, { source_uid: "" }],
    },
  });
});
it("does not load calendar history after candidate exhaustion", async () => {
  const groupBy = jest.fn();
  const tx = {
    projectTask: { findMany: jest.fn().mockResolvedValue([]) }, event: { groupBy },
  } as unknown as Prisma.TransactionClient;
  expect(await readProjectCalendarTaskBatch(tx, scope, null)).toEqual({ tasks: [], unsent: [] });
  expect(groupBy).not.toHaveBeenCalled();
});
