/** Opt-in personal notification paging. Cursor positions never confer authority. */
import { z } from "zod";
import type { Prisma } from "@prisma/client";
const MAX = 100;
type Scope = { userId: string; unreadOnly: boolean; includeSnoozed: boolean };
type Position = { createdAt: Date; id: string };
const cursorValue = z.tuple([
  z.literal("herewoven.notification-page.v1"),
  z.string().min(1).max(128), z.boolean(), z.boolean(),
  z.string().datetime(), z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
]);
export type NotificationPaging =
  | { ok: true; paged: false }
  | { ok: true; paged: true; limit: number; cursor: Position | null }
  | { ok: false; error: string };
export function encodeNotificationCursor(scope: Scope, row: { created_at: Date; id: string }) {
  return Buffer.from(JSON.stringify([
    "herewoven.notification-page.v1", scope.userId, scope.unreadOnly,
    scope.includeSnoozed, row.created_at.toISOString(), row.id,
  ]), "utf8").toString("base64url");
}
export function parseNotificationPaging(params: URLSearchParams, scope: Scope): NotificationPaging {
  const limit = params.get("limit"), cursor = params.get("cursor");
  if (params.getAll("limit").length > 1 || params.getAll("cursor").length > 1)
    return { ok: false, error: "Duplicate notification paging parameter" };
  if (limit === null) return cursor === null
    ? { ok: true, paged: false }
    : { ok: false, error: "cursor requires limit" };
  if (!/^\d{1,3}$/.test(limit) || Number(limit) < 1 || Number(limit) > MAX)
    return { ok: false, error: "limit must be a whole number from 1 to 100" };
  for (const key of ["unread", "includeSnoozed"]) {
    if (params.getAll(key).length > 1 || (params.has(key) && !["true", "false"].includes(params.get(key)!)))
      return { ok: false, error: "Invalid notification filter" };
  }
  let position: Position | null = null;
  if (cursor !== null) {
    try {
      if (!cursor.length || cursor.length > 1024) throw new Error();
      const bytes = Buffer.from(cursor, "base64url");
      if (bytes.toString("base64url") !== cursor) throw new Error();
      const value = cursorValue.parse(JSON.parse(bytes.toString("utf8")));
      if (value[1] !== scope.userId || value[2] !== scope.unreadOnly || value[3] !== scope.includeSnoozed) throw new Error();
      position = { createdAt: new Date(value[4]), id: value[5] };
    } catch { return { ok: false, error: "Invalid cursor for this notification filter" }; }
  }
  return { ok: true, paged: true, limit: Number(limit), cursor: position };
}
export function afterNotificationCursor(position: Position): Prisma.NotificationWhereInput {
  return { OR: [
    { created_at: { lt: position.createdAt } },
    { created_at: position.createdAt, id: { gt: position.id } },
  ] };
}
