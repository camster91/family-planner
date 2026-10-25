/** Stored notification strings are strict internal destinations, not URLs or authority.
 * Every focused target is re-authorized by its server reader when opened.
 */
import { MEMBER_ID_PATTERN } from "@/lib/member-identity-schema";
const CHORE_FOCUS_PREFIX = "/dashboard/chores?focus=";
export function choreNotificationDestination(id: string): `/dashboard/chores?focus=${string}` | null {
  return MEMBER_ID_PATTERN.test(id) ? `${CHORE_FOCUS_PREFIX}${id}` : null;
}
export function choreNotificationFocusId(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith(CHORE_FOCUS_PREFIX)) return null;
  const id = value.slice(CHORE_FOCUS_PREFIX.length);
  return MEMBER_ID_PATTERN.test(id) ? id : null;
}
export function notificationDestination(value: unknown): "/dashboard/today" | `/dashboard/chores?focus=${string}` | null {
  if (value === "/dashboard/today") return value;
  const choreId = choreNotificationFocusId(value);
  return choreId ? choreNotificationDestination(choreId) : null;
}
