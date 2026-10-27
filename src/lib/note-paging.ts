/** Additive notes paging; a position never supplies household authority. */
import { z } from "zod";
import type { Prisma } from "@prisma/client";
type Position = { createdAt: Date; id: string };
export const NOTE_PAGE_MAX = 100;
const cursorSchema = z.tuple([
  z.literal("herewoven.notes-page.v1"), z.string().min(1).max(128),
  z.string().datetime(), z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
]);
export type NotePaging =
  | { ok: true; paged: false }
  | { ok: true; paged: true; limit: number; cursor: Position | null }
  | { ok: false; error: string };
export function encodeNoteCursor(familyId: string, row: { created_at: Date; id: string }) {
  return Buffer.from(JSON.stringify([
    "herewoven.notes-page.v1", familyId, row.created_at.toISOString(), row.id,
  ]), "utf8").toString("base64url");
}
export function parseNotePaging(params: URLSearchParams, familyId: string): NotePaging {
  const limit = params.get("limit"), cursor = params.get("cursor");
  for (const key of ["limit", "cursor"]) {
    if (params.getAll(key).length > 1) return { ok: false, error: "Duplicate notes paging parameter" };
  }
  if (limit === null) return cursor === null
    ? { ok: true, paged: false }
    : { ok: false, error: "cursor requires limit" };
  if (!/^\d{1,3}$/.test(limit) || Number(limit) < 1 || Number(limit) > NOTE_PAGE_MAX)
    return { ok: false, error: "limit must be a whole number from 1 to 100" };
  let position: Position | null = null;
  if (cursor !== null) {
    try {
      if (!cursor.length || cursor.length > 1024) throw new Error();
      const bytes = Buffer.from(cursor, "base64url");
      if (bytes.toString("base64url") !== cursor) throw new Error();
      const value = cursorSchema.parse(JSON.parse(bytes.toString("utf8")));
      if (value[1] !== familyId) throw new Error();
      position = { createdAt: new Date(value[2]), id: value[3] };
    } catch { return { ok: false, error: "Invalid cursor for this household" }; }
  }
  return { ok: true, paged: true, limit: Number(limit), cursor: position };
}
export function afterNoteCursor(position: Position): Prisma.PinnedNoteWhereInput {
  return { OR: [
    { created_at: { lt: position.createdAt } },
    { created_at: position.createdAt, id: { gt: position.id } },
  ] };
}
