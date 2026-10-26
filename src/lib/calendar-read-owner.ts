import { z } from "zod";
/** Comparison metadata only. Authentication and current household authorization
 * remain mandatory on every request; this header never grants access. */
export const CALENDAR_OWNER_HEADER = "X-Herewoven-Calendar-Owner";
export const CALENDAR_OWNER_PROTOCOL = "herewoven.calendar-owner.v1";
export const calendarOwnerSchema = z.object({
  protocol: z.literal(CALENDAR_OWNER_PROTOCOL),
  actorId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  familyId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  role: z.string().min(1).max(32),
  generation: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict();
export type CalendarReadOwner = z.infer<typeof calendarOwnerSchema>;
export function readCalendarOwner(value: string | null): CalendarReadOwner | null {
  if (!value || value.length > 1024) return null;
  try {
    const parsed = calendarOwnerSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}
export function sameCalendarOwner(a: CalendarReadOwner | null, b: CalendarReadOwner | null): boolean {
  return Boolean(a && b && a.actorId === b.actorId && a.familyId === b.familyId &&
    a.role === b.role && a.generation === b.generation);
}
