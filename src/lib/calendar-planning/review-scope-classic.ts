/** Server compatibility view for the browser-safe schedule review scope. */
import { z } from "zod";
import {
  scheduleReviewScope as miniScheduleReviewScope,
  type ScheduleReviewScope,
} from "@/lib/calendar-planning/review-scope";

export const scheduleReviewScopeClassic = z.pipe(
  z.unknown(),
  miniScheduleReviewScope,
) as z.ZodType<ScheduleReviewScope>;
