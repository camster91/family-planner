/** Browser-safe read scope. Canonical planner/state contracts remain separate. */
import { z } from "zod";
import { parseCalendarInstant, CALENDAR_RANGE_MAX_MS } from "./instant";
import { isValidTimeZone } from "@/lib/calendar-import/timezone";
import { memberIdentityIdSchema as id } from "@/lib/member-subject-contract";
export const reviewInstant = z.string().refine((value) => {
  try {
    parseCalendarInstant(value);
    return true;
  } catch {
    return false;
  }
});
export const reviewInterval = z
  .object({ start: reviewInstant, end: reviewInstant })
  .strict()
  .refine(
    (value) => Date.parse(value.end) > Date.parse(value.start),
    "Positive interval required",
  );
export const reviewComparisonInterval = reviewInterval.refine(
  (value) =>
    Date.parse(value.end) - Date.parse(value.start) <= CALENDAR_RANGE_MAX_MS,
  "Comparison range is at most 45 days",
);
/** Shared read scope. A fingerprint cannot reconstruct or authorize a range. */
export const scheduleReviewScope = z
  .object({
    targetId: id,
    range: reviewComparisonInterval,
    timeZone: z.string().max(100).refine(isValidTimeZone),
  })
  .strict()
  .refine(
    (value) =>
      Date.parse(value.range.end) - Date.parse(value.range.start) <=
      CALENDAR_RANGE_MAX_MS,
    "Comparison range is at most 45 days",
  );
export type ScheduleReviewScope = z.infer<typeof scheduleReviewScope>;
