/** Additive keyset paging for the legacy all-member activity API.
 * Cursors bind a household/read mode, never confer authorization or a snapshot.
 */
import { z } from "zod";
import type { Prisma } from "@prisma/client";
export const ACTIVITY_PAGING_MODE = "keyset-v1";
type Position = { createdAt: Date; id: string };
const valueSchema = z.tuple([
  z.literal("herewoven.activity-page.v1"), z.string().min(1).max(128),
  z.string().datetime(), z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
]);
export type ActivityPaging = { ok: true; limit: number; cursor: Position | null } | { ok: false; error: string };
export function encodeActivityCursor(familyId: string, row: { created_at: Date; id: string }): string {
  return Buffer.from(JSON.stringify(["herewoven.activity-page.v1", familyId, row.created_at.toISOString(), row.id]), "utf8").toString("base64url");
}
export function parseActivityPaging(params: URLSearchParams, familyId: string): ActivityPaging {
  if (["paging", "limit", "cursor"].some(key => params.getAll(key).length > 1) || params.get("paging") !== ACTIVITY_PAGING_MODE)
    return { ok: false, error: "Invalid activity paging mode" };
  const rawLimit = params.get("limit") ?? "30";
  if (!/^\d{1,3}$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 100)
    return { ok: false, error: "limit must be a whole number from 1 to 100" };
  const cursor = params.get("cursor");
  let position: Position | null = null;
  if (cursor !== null) {
    try {
      if (!cursor.length || cursor.length > 1024) throw new Error();
      const bytes = Buffer.from(cursor, "base64url");
      if (bytes.toString("base64url") !== cursor) throw new Error();
      const value = valueSchema.parse(JSON.parse(bytes.toString("utf8")));
      const createdAt = new Date(value[2]);
      if (value[1] !== familyId || createdAt.toISOString() !== value[2]) throw new Error();
      position = { createdAt, id: value[3] };
    } catch { return { ok: false, error: "Invalid cursor for this activity feed" }; }
  }
  return { ok: true, limit: Number(rawLimit), cursor: position };
}
export function afterActivityCursor(position: Position): Prisma.ActivityWhereInput {
  return { OR: [
    { created_at: { lt: position.createdAt } },
    { created_at: position.createdAt, id: { gt: position.id } },
  ] };
}
