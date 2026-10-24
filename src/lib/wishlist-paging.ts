/** Additive wishlist paging. Bound positions never grant household authority. */
import { z } from "zod";
import type { Prisma } from "@prisma/client";
type Scope = { familyId: string; requesterId: string | null };
type Position = { createdAt: Date; id: string };
export const WISHLIST_PAGE_MAX = 100;
const valueSchema = z.tuple([
  z.literal("herewoven.wishlist-page.v1"), z.string().min(1).max(128),
  z.string().min(1).max(128).nullable(), z.string().datetime(),
  z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
]);
export type WishlistPaging =
  | { ok: true; paged: false }
  | { ok: true; paged: true; limit: number; cursor: Position | null }
  | { ok: false; error: string };
export function encodeWishlistCursor(scope: Scope, row: { created_at: Date; id: string }) {
  return Buffer.from(JSON.stringify([
    "herewoven.wishlist-page.v1", scope.familyId, scope.requesterId,
    row.created_at.toISOString(), row.id,
  ]), "utf8").toString("base64url");
}
export function parseWishlistPaging(params: URLSearchParams, scope: Scope): WishlistPaging {
  const limit = params.get("limit"), cursor = params.get("cursor");
  for (const key of ["limit", "cursor", "mine"]) {
    if (params.getAll(key).length > 1) return { ok: false, error: "Duplicate wishlist paging parameter" };
  }
  if (limit === null) return cursor === null && !params.has("mine")
    ? { ok: true, paged: false }
    : { ok: false, error: "cursor and mine require limit" };
  if (!/^\d{1,3}$/.test(limit) || Number(limit) < 1 || Number(limit) > WISHLIST_PAGE_MAX)
    return { ok: false, error: "limit must be a whole number from 1 to 100" };
  if (params.has("mine") && !["true", "false"].includes(params.get("mine")!))
    return { ok: false, error: "Invalid wishlist filter" };
  let position: Position | null = null;
  if (cursor !== null) {
    try {
      if (!cursor.length || cursor.length > 1024) throw new Error();
      const bytes = Buffer.from(cursor, "base64url");
      if (bytes.toString("base64url") !== cursor) throw new Error();
      const value = valueSchema.parse(JSON.parse(bytes.toString("utf8")));
      if (value[1] !== scope.familyId || value[2] !== scope.requesterId) throw new Error();
      position = { createdAt: new Date(value[3]), id: value[4] };
    } catch { return { ok: false, error: "Invalid cursor for this wishlist filter" }; }
  }
  return { ok: true, paged: true, limit: Number(limit), cursor: position };
}
export function afterWishlistCursor(position: Position): Prisma.WishlistItemWhereInput {
  return { OR: [
    { created_at: { lt: position.createdAt } },
    { created_at: position.createdAt, id: { gt: position.id } },
  ] };
}
