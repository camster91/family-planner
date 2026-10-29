/** Opt-in item positions, bound to the canonical household and list. */
import { z } from "zod";
import type { Prisma } from "@prisma/client";
export const LIST_ITEM_PAGE_SIZE = 100;
export const LIST_ITEM_PAGE_MAX = 200;
type Scope = { familyId: string; listId: string };
type Position = { position: number; createdAt: Date; id: string };
const schema = z.tuple([
  z.literal("herewoven.list-items.v1"),
  z.string().min(1).max(128),
  z.string().min(1).max(128),
  z.number().int().min(-2147483648).max(2147483647),
  z.string().datetime(),
  z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
]);
export type ListItemPaging =
  | { ok: true; paged: false }
  | { ok: true; paged: true; limit: number; cursor: Position | null }
  | { ok: false; error: string };
export function encodeListItemCursor(
  scope: Scope,
  row: { position: number; created_at: Date; id: string },
) {
  return Buffer.from(
    JSON.stringify([
      "herewoven.list-items.v1",
      scope.familyId,
      scope.listId,
      row.position,
      row.created_at.toISOString(),
      row.id,
    ]),
    "utf8",
  ).toString("base64url");
}
export function parseListItemPaging(
  params: URLSearchParams,
  scope: Scope,
): ListItemPaging {
  const limit = params.get("limit"),
    cursor = params.get("cursor");
  if (params.getAll("limit").length > 1 || params.getAll("cursor").length > 1)
    return { ok: false, error: "Duplicate item paging parameter" };
  if (limit === null)
    return cursor === null
      ? { ok: true, paged: false }
      : { ok: false, error: "cursor requires limit" };
  if (
    !/^\d{1,3}$/.test(limit) ||
    Number(limit) < 1 ||
    Number(limit) > LIST_ITEM_PAGE_MAX
  )
    return {
      ok: false,
      error: `limit must be a whole number from 1 to ${LIST_ITEM_PAGE_MAX}`,
    };
  let position: Position | null = null;
  if (cursor !== null) {
    try {
      if (!cursor.length || cursor.length > 1024) throw new Error("cursor");
      const bytes = Buffer.from(cursor, "base64url");
      if (bytes.toString("base64url") !== cursor) throw new Error("cursor");
      const value = schema.parse(JSON.parse(bytes.toString("utf8")));
      if (value[1] !== scope.familyId || value[2] !== scope.listId)
        throw new Error("cursor");
      position = {
        position: value[3],
        createdAt: new Date(value[4]),
        id: value[5],
      };
    } catch {
      return { ok: false, error: "Invalid cursor for this list" };
    }
  }
  return { ok: true, paged: true, limit: Number(limit), cursor: position };
}
export function afterListItemCursor(cursor: Position) {
  return {
    OR: [
      { position: { gt: cursor.position } },
      { position: cursor.position, created_at: { gt: cursor.createdAt } },
      {
        position: cursor.position,
        created_at: cursor.createdAt,
        id: { gt: cursor.id },
      },
    ],
  };
}
export const LIST_ITEM_PAGE_ORDER = [
  { position: "asc" },
  { created_at: "asc" },
  { id: "asc" },
] satisfies Prisma.ListItemOrderByWithRelationInput[];
