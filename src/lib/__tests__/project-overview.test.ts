/** Authored for deferred QA; no execution or database proof claimed. */
import type { PrismaClient } from "@prisma/client";
import { readProjectOverview } from "../project-overview";
it("reads bounded projects and aggregate task counts only for the returned page", async () => {
  const row = (id: string) => ({ id, created_at: new Date("2026-10-24T12:00:00Z"), name: id, status: "active", creator: null });
  const findMany = jest.fn().mockResolvedValue([row("fixture-a"), row("fixture-b"), row("fixture-extra")]);
  const groupBy = jest.fn().mockResolvedValue([
    { project_id: "fixture-a", completed: false, _count: { _all: 7 } },
    { project_id: "fixture-a", completed: true, _count: { _all: 3 } },
  ]);
  const db = { project: { findMany }, projectTask: { groupBy } } as unknown as Pick<PrismaClient, "project" | "projectTask">;
  const result = await readProjectOverview(db, { familyId: "fixture-family-a", status: "active" }, { ok: true, paged: true, limit: 2, cursor: null });
  expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { family_id: "fixture-family-a", status: "active" }, take: 3 }));
  expect(findMany.mock.calls[0][0].include.tasks).toBeUndefined();
  expect(groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { project_id: { in: ["fixture-a", "fixture-b"] }, project: { family_id: "fixture-family-a" } } }));
  expect(result.projects.map(p => [p.id, p.taskCount, p.completedTaskCount])).toEqual([["fixture-a", 10, 3], ["fixture-b", 0, 0]]);
  expect(result.nextCursor).toEqual(expect.any(String));
});
it("does not make a task query for an empty page or advertise a legacy cursor", async () => {
  const groupBy = jest.fn();
  const db = { project: { findMany: jest.fn().mockResolvedValue([]) }, projectTask: { groupBy } } as unknown as Pick<PrismaClient, "project" | "projectTask">;
  expect(await readProjectOverview(db, { familyId: "fixture-family-a", status: null }, { ok: true, paged: false })).toEqual({ projects: [] });
  expect(groupBy).not.toHaveBeenCalled();
});
