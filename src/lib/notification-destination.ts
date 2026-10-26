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
const REWARD_FOCUS_PREFIX = "/dashboard/rewards?focus=";
export function rewardNotificationDestination(id: string): `/dashboard/rewards?focus=${string}` | null {
  return typeof id === "string" && MEMBER_ID_PATTERN.test(id) ? `${REWARD_FOCUS_PREFIX}${id}` : null;
}
export function rewardNotificationFocusId(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith(REWARD_FOCUS_PREFIX)) return null;
  const id = value.slice(REWARD_FOCUS_PREFIX.length);
  return MEMBER_ID_PATTERN.test(id) ? id : null;
}
const RECIPE_DETAIL_PREFIX = "/dashboard/meals/recipes/";
export function recipeNotificationDestination(id: string): `/dashboard/meals/recipes/${string}` | null {
  return typeof id === "string" && MEMBER_ID_PATTERN.test(id) ? `${RECIPE_DETAIL_PREFIX}${id}` : null;
}
export function recipeNotificationTargetId(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith(RECIPE_DETAIL_PREFIX)) return null;
  const id = value.slice(RECIPE_DETAIL_PREFIX.length);
  return MEMBER_ID_PATTERN.test(id) ? id : null;
}
const LIST_DETAIL_PREFIX = "/dashboard/lists/";
// These paths resolve static/alias pages rather than a canonical list target.
const RESERVED_LIST_TARGETS = new Set(["create", "groceries", "type"]);
export function listNotificationDestination(id: string): `/dashboard/lists/${string}` | null {
  return typeof id === "string" && MEMBER_ID_PATTERN.test(id) && !RESERVED_LIST_TARGETS.has(id) ? `${LIST_DETAIL_PREFIX}${id}` : null;
}
export function listNotificationTargetId(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith(LIST_DETAIL_PREFIX)) return null;
  const id = value.slice(LIST_DETAIL_PREFIX.length);
  return MEMBER_ID_PATTERN.test(id) && !RESERVED_LIST_TARGETS.has(id) ? id : null;
}
export type NotificationDestination = "/dashboard/today" | `/dashboard/chores?focus=${string}` |
  `/dashboard/rewards?focus=${string}` | `/dashboard/meals/recipes/${string}` | `/dashboard/lists/${string}`;
export function notificationDestination(value: unknown): NotificationDestination | null {
  if (value === "/dashboard/today") return value;
  const choreId = choreNotificationFocusId(value);
  if (choreId) return choreNotificationDestination(choreId);
  const rewardId = rewardNotificationFocusId(value);
  if (rewardId) return rewardNotificationDestination(rewardId);
  const recipeId = recipeNotificationTargetId(value);
  if (recipeId) return recipeNotificationDestination(recipeId);
  const listId = listNotificationTargetId(value);
  return listId ? listNotificationDestination(listId) : null;
}
