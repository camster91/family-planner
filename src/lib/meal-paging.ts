/** Opt-in, range-bound keyset paging. Legacy meal callers retain their contract. */
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { MEAL_PAGE_MAX } from "./meal-paging-contract";
const iso = z.string().datetime();
const cursorSchema = z.tuple([
  z.literal(1),
  z.string().min(1).max(128),
  iso,
  iso,
  iso,
  iso,
  z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
]);
type Scope = { familyId: string; start: Date; end: Date };
type Cursor = { date: Date; createdAt: Date; id: string };
export type MealPaging =
  | { ok: true; paged: false }
  | { ok: true; paged: true; limit: number; cursor: Cursor | null }
  | { ok: false; error: string };
export function encodeMealCursor(
  scope: Scope,
  row: { date: Date; created_at: Date; id: string },
): string {
  return Buffer.from(
    JSON.stringify([
      1,
      scope.familyId,
      scope.start.toISOString(),
      scope.end.toISOString(),
      row.date.toISOString(),
      row.created_at.toISOString(),
      row.id,
    ]),
    "utf8",
  ).toString("base64url");
}
export function parseMealPaging(
  params: URLSearchParams,
  scope: Scope,
): MealPaging {
  const rawLimit = params.get("limit"),
    rawCursor = params.get("cursor");
  if (params.getAll("limit").length > 1 || params.getAll("cursor").length > 1)
    return { ok: false, error: "Duplicate paging parameter" };
  if (rawLimit === null)
    return rawCursor === null
      ? { ok: true, paged: false }
      : { ok: false, error: "cursor requires limit" };
  if (
    !/^\d{1,3}$/.test(rawLimit) ||
    Number(rawLimit) < 1 ||
    Number(rawLimit) > MEAL_PAGE_MAX
  )
    return {
      ok: false,
      error: `limit must be a whole number from 1 to ${MEAL_PAGE_MAX}`,
    };
  let cursor: Cursor | null = null;
  if (rawCursor !== null) {
    try {
      if (!rawCursor.length || rawCursor.length > 1024)
        throw new Error("cursor");
      const bytes = Buffer.from(rawCursor, "base64url");
      if (bytes.toString("base64url") !== rawCursor) throw new Error("cursor");
      const value = cursorSchema.parse(JSON.parse(bytes.toString("utf8")));
      if (
        value[1] !== scope.familyId ||
        value[2] !== scope.start.toISOString() ||
        value[3] !== scope.end.toISOString()
      )
        throw new Error("cursor");
      const date = new Date(value[4]);
      if (date < scope.start || date >= scope.end) throw new Error("cursor");
      cursor = { date, createdAt: new Date(value[5]), id: value[6] };
    } catch {
      return { ok: false, error: "Invalid cursor for this meal range" };
    }
  }
  return { ok: true, paged: true, limit: Number(rawLimit), cursor };
}
export function afterMealCursor(cursor: Cursor): Prisma.FamilyMealWhereInput {
  return {
    OR: [
      { date: { gt: cursor.date } },
      { date: cursor.date, created_at: { gt: cursor.createdAt } },
      {
        date: cursor.date,
        created_at: cursor.createdAt,
        id: { gt: cursor.id },
      },
    ],
  };
}
