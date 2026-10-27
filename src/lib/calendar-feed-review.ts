/** Server-only source/cursor handling; no provider or calendar mutation. */
import { z } from "zod";
import { calendarFeedRule, CalendarFeedInvalidRule } from "./calendar-feed-rule";
const position = z.tuple([z.literal("herewoven.feed-review.v1"),
  z.string().min(1).max(128), z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)]);
export function feedReviewCursor(familyId: string, id: string) {
  return Buffer.from(JSON.stringify(position.parse(["herewoven.feed-review.v1", familyId, id])), "utf8").toString("base64url");
}
export function parseFeedReviewCursor(params: URLSearchParams, familyId: string): string | null {
  if (params.getAll("cursor").length > 1) throw new Error("Invalid feed review cursor");
  const cursor = params.get("cursor");
  if (cursor === null) return null;
  try {
    if (!cursor.length || cursor.length > 1024) throw new Error();
    const bytes = Buffer.from(cursor, "base64url");
    if (bytes.toString("base64url") !== cursor) throw new Error();
    const value = position.parse(JSON.parse(bytes.toString("utf8")));
    if (value[1] !== familyId) throw new Error();
    return value[2];
  } catch { throw new Error("Invalid feed review cursor"); }
}
export function feedRuleNeedsReview(raw: string): boolean {
  try { calendarFeedRule(raw); return false; }
  catch (error) { if (error instanceof CalendarFeedInvalidRule) return true; throw error; }
}
