/** Additive summary response only; never a request, replay or ownership receipt. */
import { z } from "zod";
export const PROJECT_CALENDAR_SUMMARY_MODE = "summary-v1";
export const PROJECT_CALENDAR_SUMMARY_PROTOCOL = "herewoven.project-calendar-summary.v1";
export const projectCalendarSummary = z.object({
  protocol: z.literal(PROJECT_CALENDAR_SUMMARY_PROTOCOL),
  state: z.enum(["created", "no-tasks", "all-sent"]),
  eventsCreated: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
}).strict().refine((value) => value.state === "created" ? value.eventsCreated > 0 : value.eventsCreated === 0);
