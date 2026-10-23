/** Additive list-summary paging. A cursor is a read position, never authority. */
import { z } from "zod";
import type { Prisma } from "@prisma/client";
export const LIST_PAGE_MAX = 200;
export const LIST_OVERVIEW_PAGE_SIZE = 100;
type Scope = { familyId: string; type: string | null };
type Cursor = { createdAt: Date; id: string };
const cursorSchema = z.tuple([
  z.literal("herewoven.list-page.v1"),
  z.string().min(1).max(128),
  z.string().max(128).nullable(),
  z.string().datetime(),
  z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
]);
export type ListPaging =
  | { ok: true; paged: false }
  | { ok: true; paged: true; limit: number; cursor: Cursor | null }
  | { ok: false; error: string };
export function encodeListCursor(
  scope: Scope,
  row: { created_at: Date; id: string },
) {
  return Buffer.from(
    JSON.stringify([
      "herewoven.list-page.v1",
      scope.familyId,
      scope.type,
      row.created_at.toISOString(),
      row.id,
    ]),
    "utf8",
  ).toString("base64url");
}
export function parseListPaging(
  params: URLSearchParams,
  scope: Scope,
): ListPaging {
  const limit = params.get("limit"),
    cursor = params.get("cursor");
  if (
    params.getAll("limit").length > 1 ||
    params.getAll("cursor").length > 1 ||
    (limit !== null && params.getAll("type").length > 1)
  )
    return { ok: false, error: "Duplicate list paging parameter" };
  if (limit === null)
    return cursor === null
      ? { ok: true, paged: false }
      : { ok: false, error: "cursor requires limit" };
  if (
    !/^\d{1,3}$/.test(limit) ||
    Number(limit) < 1 ||
    Number(limit) > LIST_PAGE_MAX
  )
    return {
      ok: false,
      error: `limit must be a whole number from 1 to ${LIST_PAGE_MAX}`,
    };
  // Legacy arbitrary type filters keep their old behavior. Opt-in scopes must
  // remain bounded and reproducible in the cursor, including an absent filter.
  if (scope.type !== null && scope.type.length > 128)
    return { ok: false, error: "Invalid list type filter" };
  let position: Cursor | null = null;
  if (cursor !== null) {
    try {
      if (!cursor.length || cursor.length > 1024) throw new Error("cursor");
      const bytes = Buffer.from(cursor, "base64url");
      if (bytes.toString("base64url") !== cursor) throw new Error("cursor");
      const value = cursorSchema.parse(JSON.parse(bytes.toString("utf8")));
      if (value[1] !== scope.familyId || value[2] !== scope.type)
        throw new Error("cursor");
      position = { createdAt: new Date(value[3]), id: value[4] };
    } catch {
      return { ok: false, error: "Invalid cursor for this list filter" };
    }
  }
  return { ok: true, paged: true, limit: Number(limit), cursor: position };
}
export function afterListCursor(cursor: Cursor): Prisma.ListWhereInput {
  return {
    OR: [
      { created_at: { lt: cursor.createdAt } },
      { created_at: cursor.createdAt, id: { gt: cursor.id } },
    ],
  };
}
