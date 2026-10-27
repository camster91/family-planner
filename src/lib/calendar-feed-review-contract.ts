/** Parent-only recurrence diagnostics. No token, raw rule or write command. */
import { z } from "zod";
export const CALENDAR_FEED_REVIEW_PAGE_SIZE = 100;
export const CALENDAR_FEED_REVIEW_SCOPE_HEADER = "X-Herewoven-Feed-Review-Household";
export const calendarFeedReviewPage = z.object({
  checked: z.number().int().min(0).max(CALENDAR_FEED_REVIEW_PAGE_SIZE),
  issues: z.array(z.object({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    title: z.string().max(200),
    source: z.enum(["local", "connected", "subscribed"]),
  }).strict()).max(CALENDAR_FEED_REVIEW_PAGE_SIZE),
  nextCursor: z.string().min(1).max(1024).nullable(),
}).strict().refine(value => value.issues.length <= value.checked &&
  new Set(value.issues.map(issue => issue.id)).size === value.issues.length &&
  (value.nextCursor === null || value.checked === CALENDAR_FEED_REVIEW_PAGE_SIZE));
export type CalendarFeedReviewPage = z.infer<typeof calendarFeedReviewPage>;
