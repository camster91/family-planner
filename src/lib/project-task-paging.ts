/** Opt-in task keysets; read positions never establish household/project authority. */
import { z } from "zod";
import type { Prisma } from "@prisma/client";
export const PROJECT_TASK_PAGE_SIZE = 40;
export const PROJECT_TASK_PAGE_MAX = 100;
type Scope = { familyId: string; projectId: string; completed: boolean | null };
type Cursor = { position: number; createdAt: Date; id: string };
const cursorSchema = z.tuple([
  z.literal("herewoven.project-task-page.v1"),
  z.string().min(1).max(128), z.string().min(1).max(128), z.boolean().nullable(),
  z.number().int().min(-2147483648).max(2147483647), z.string().datetime(),
  z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
]);
export type ProjectTaskPaging =
  | { ok: true; paged: false }
  | { ok: true; paged: true; limit: number; cursor: Cursor | null }
  | { ok: false; error: string };
export function encodeProjectTaskCursor(scope: Scope, row: { position: number; created_at: Date; id: string }) {
  return Buffer.from(JSON.stringify([
    "herewoven.project-task-page.v1", scope.familyId, scope.projectId, scope.completed,
    row.position, row.created_at.toISOString(), row.id,
  ]), "utf8").toString("base64url");
}
export function parseProjectTaskPaging(params: URLSearchParams, scope: Scope): ProjectTaskPaging {
  const limit = params.get("limit"), cursor = params.get("cursor");
  if (params.getAll("limit").length > 1 || params.getAll("cursor").length > 1 ||
    (limit !== null && params.getAll("completed").length > 1))
    return { ok: false, error: "Duplicate task paging parameter" };
  if (limit === null) return cursor === null
    ? { ok: true, paged: false } : { ok: false, error: "cursor requires limit" };
  if (!/^\d{1,3}$/.test(limit) || Number(limit) < 1 || Number(limit) > PROJECT_TASK_PAGE_MAX)
    return { ok: false, error: `limit must be 1-${PROJECT_TASK_PAGE_MAX}` };
  const completed = params.get("completed");
  if (completed !== null && completed !== "true" && completed !== "false")
    return { ok: false, error: "Invalid completed filter" };
  let position: Cursor | null = null;
  if (cursor !== null) {
    try {
      if (!cursor.length || cursor.length > 2048) throw new Error("cursor");
      const bytes = Buffer.from(cursor, "base64url");
      if (bytes.toString("base64url") !== cursor) throw new Error("cursor");
      const value = cursorSchema.parse(JSON.parse(bytes.toString("utf8")));
      if (value[1] !== scope.familyId || value[2] !== scope.projectId || value[3] !== scope.completed)
        throw new Error("cursor");
      position = { position: value[4], createdAt: new Date(value[5]), id: value[6] };
    } catch { return { ok: false, error: "Invalid cursor for this project's task filter" }; }
  }
  return { ok: true, paged: true, limit: Number(limit), cursor: position };
}
export function afterProjectTaskCursor(cursor: Cursor): Prisma.ProjectTaskWhereInput {
  return { OR: [
    { position: { gt: cursor.position } },
    { position: cursor.position, created_at: { gt: cursor.createdAt } },
    { position: cursor.position, created_at: cursor.createdAt, id: { gt: cursor.id } },
  ] };
}
export const projectTaskPageOrder = [
  { position: "asc" }, { created_at: "asc" }, { id: "asc" },
] satisfies Prisma.ProjectTaskOrderByWithRelationInput[];
