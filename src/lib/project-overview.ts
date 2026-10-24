import type { PrismaClient, Prisma } from "@prisma/client";
import { afterProjectCursor, encodeProjectCursor, type ProjectPaging } from "./project-paging";

type Db = Pick<PrismaClient, "project" | "projectTask">;
/** Canonical summary read: completed task IDs never enter the response graph. */
export async function readProjectOverview(
  db: Db,
  scope: { familyId: string; status: string | null },
  paging: Extract<ProjectPaging, { ok: true }>,
) {
  const where: Prisma.ProjectWhereInput = {
    family_id: scope.familyId,
    ...(scope.status ? { status: scope.status } : {}),
    ...(paging.paged && paging.cursor ? afterProjectCursor(paging.cursor) : {}),
  };
  const rows = await db.project.findMany({
    where,
    include: {
      creator: { select: { id: true, name: true, avatar_url: true } },
    },
    orderBy: [{ created_at: "desc" }, { id: "asc" }],
    ...(paging.paged ? { take: paging.limit + 1 } : {}),
  });
  const page = paging.paged ? rows.slice(0, paging.limit) : rows;
  const taskCounts = page.length ? await db.projectTask.groupBy({
    by: ["project_id", "completed"],
    where: {
      project_id: { in: page.map(project => project.id) },
      project: { family_id: scope.familyId },
    },
    _count: { _all: true },
  }) : [];
  // Total and completed counts share one aggregate snapshot; loading every
  // task ID or querying the two totals independently is unnecessary.
  const counts = new Map<string, { total: number; completed: number }>();
  for (const row of taskCounts) {
    const count = counts.get(row.project_id) ?? { total: 0, completed: 0 };
    count.total += row._count._all;
    if (row.completed) count.completed += row._count._all;
    counts.set(row.project_id, count);
  }
  const projects = page.map(project => ({
    ...project,
    taskCount: counts.get(project.id)?.total ?? 0,
    completedTaskCount: counts.get(project.id)?.completed ?? 0,
  }));
  return {
    projects,
    ...(paging.paged ? {
      nextCursor: rows.length > paging.limit
        ? encodeProjectCursor(scope, page[page.length - 1])
        : null,
    } : {}),
  };
}
