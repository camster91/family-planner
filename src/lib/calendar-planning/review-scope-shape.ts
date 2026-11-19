/**
 * Zod-free browser check for the schedule review read scope. Mirrors
 * `scheduleReviewScope` (review-scope.ts), which stays the server/composition
 * contract; parity is tested.
 */
import {
  SHAPE_FAILURE,
  isStringLength,
  shapeSuccess,
  strictRecord,
  type ShapeResult,
} from "@/lib/browser-shape";
import { isMemberIdentityId } from "@/lib/member-identity-id";
import { isValidTimeZone } from "@/lib/calendar-import/timezone";
import { CALENDAR_RANGE_MAX_MS, parseCalendarInstant } from "./instant";

export type ScheduleReviewScope = {
  targetId: string;
  range: { start: string; end: string };
  timeZone: string;
};

function isReviewInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    parseCalendarInstant(value);
    return true;
  } catch {
    return false;
  }
}

export function parseScheduleReviewScope(
  value: unknown,
): ShapeResult<ScheduleReviewScope> {
  const record = strictRecord(value, ["targetId", "range", "timeZone"]);
  if (!record) return SHAPE_FAILURE;
  const { targetId, timeZone } = record;
  const range = strictRecord(record.range, ["start", "end"]);
  if (
    !range ||
    !isMemberIdentityId(targetId) ||
    !isStringLength(timeZone, 0, 100) ||
    !isValidTimeZone(timeZone)
  )
    return SHAPE_FAILURE;
  const { start, end } = range;
  if (!isReviewInstant(start) || !isReviewInstant(end)) return SHAPE_FAILURE;
  const span = Date.parse(end) - Date.parse(start);
  // Positive and at most the comparison window, as the Zod refinements require.
  if (!(span > 0) || !(span <= CALENDAR_RANGE_MAX_MS)) return SHAPE_FAILURE;
  return shapeSuccess({ targetId, range: { start, end }, timeZone });
}
