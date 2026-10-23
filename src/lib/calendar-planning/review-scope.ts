/** Browser-safe read scope. Canonical planner/state contracts remain separate. */
import { z } from "zod/mini";
import { parseCalendarInstant, CALENDAR_RANGE_MAX_MS } from "./instant";
import { isValidTimeZone } from "@/lib/calendar-import/timezone";
import { memberIdentityIdSchema as id } from "@/lib/member-identity-schema";
export const reviewInstant = z.string().check(
  z.refine((value) => {
    try {
      parseCalendarInstant(value);
      return true;
    } catch {
      return false;
    }
  }),
);
export const reviewInterval = z
  .strictObject({ start: reviewInstant, end: reviewInstant })
  .check(
    z.refine(
      (value) => Date.parse(value.end) > Date.parse(value.start),
      "Positive interval required",
    ),
  );
export const reviewComparisonInterval = reviewInterval.check(
  z.refine(
    (value) =>
      Date.parse(value.end) - Date.parse(value.start) <= CALENDAR_RANGE_MAX_MS,
    "Comparison range is at most 45 days",
  ),
);
/** Shared read scope. A fingerprint cannot reconstruct or authorize a range. */
export const scheduleReviewScope = z
  .strictObject({
    targetId: id,
    range: reviewComparisonInterval,
    timeZone: z.string().check(z.maxLength(100), z.refine(isValidTimeZone)),
  })
  .check(
    z.refine(
      (value) =>
        Date.parse(value.range.end) - Date.parse(value.range.start) <=
        CALENDAR_RANGE_MAX_MS,
      "Comparison range is at most 45 days",
    ),
  );
export type ScheduleReviewScope = {
  targetId: string;
  range: { start: string; end: string };
  timeZone: string;
};
